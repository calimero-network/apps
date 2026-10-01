import { useCallback, useEffect, useRef, useState } from "react";
import type { Ceremony, MeroVoteClient, PollView } from "./generated/MeroVoteClient";
import {
  BASE,
  branchToWire,
  deal,
  dealingFromWire,
  dealingToWire,
  decodePoint,
  decodeScalar,
  encodePoint,
  encodeScalar,
  makeComplaint,
  makeTransportKey,
  openShare,
  partialDecrypt,
  secureRng,
} from "./crypto/protocol";
import { errText, short } from "./useMeroVote";
import {
  backupFileName,
  loadTrusteeKey,
  parseTrusteeKey,
  saveTrusteeKey,
  type TrusteeKey,
} from "./utils/trusteeKeys";

/**
 * The t-of-n key ceremony and the tally, from one trustee's seat — plus the
 * creator's controls for the ceremony.
 *
 * Every secret here stays in this browser: the transport secret `e` (the only
 * thing saved, with a downloadable backup), the dealing polynomial (thrown
 * away as soon as it is dealt), and the combined key `xⱼ` (re-derived from
 * the frozen dealings whenever it is needed, never stored).
 */
export function TrusteePanel({
  client,
  contextId,
  view,
  me,
  label,
  isCreator,
  busy,
  act,
  onNote,
  onError,
  download,
}: {
  client: MeroVoteClient | null;
  contextId: string;
  view: PollView;
  me: string | null;
  label: (account: string) => string;
  isCreator: boolean;
  busy: string | null;
  act: (name: string, fn: () => Promise<unknown>, done?: string) => Promise<void>;
  onNote: (s: string) => void;
  onError: (s: string) => void;
  download: (name: string, text: string) => void;
}) {
  const pollId = view.poll_id;
  const def = view.definition;
  const phase = view.state.phase;
  const election = view.state.election;
  const t = def.threshold;
  const n = def.trustees.length;
  const myIndex = me ? def.trustees.indexOf(me) + 1 : 0;
  const amTrustee = myIndex > 0;
  const mine = view.trustees.find((x) => x.account === me);
  const [trusteeKey, setTrusteeKey] = useState<TrusteeKey | null>(null);
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (me) setTrusteeKey(loadTrusteeKey(contextId, pollId, me));
  }, [contextId, pollId, me]);

  const loadCeremony = useCallback(async () => {
    if (!client || phase !== "KeyCeremony") return;
    try {
      setCeremony(await client.ceremony({ poll_id: pollId }));
    } catch (e) {
      onError(errText(e));
    }
  }, [client, phase, pollId, onError]);
  // `view` changes on every refresh, which is exactly when the ceremony may have moved.
  useEffect(() => void loadCeremony(), [loadCeremony, view]);

  const allTransport = view.trustees.every((x) => x.transport_published);
  const qualifiedNow = view.trustees.filter((x) => x.dealing_published && x.complaints_against === 0).length;
  const myTransport = election ? election.transport[myIndex - 1] : ceremony?.trustees[myIndex - 1]?.transport;

  // What the shares dealt to me look like — only computable here, with my `e`.
  const received =
    amTrustee && trusteeKey && ceremony
      ? ceremony.trustees
          .filter((x) => x.dealing)
          .map((x) => {
            let ok = false;
            try {
              ok = openShare(pollId, x.account, myIndex, decodeScalar(trusteeKey.secret), dealingFromWire(x.dealing!)) !== null;
            } catch {
              ok = false;
            }
            const complained = ceremony.complaints.some((c) => c.recipient === me && c.dealer === x.account);
            return { dealer: x.account, ok, complained };
          })
      : [];

  // ── actions ──────────────────────────────────────────────────────────────

  function publishTransport() {
    if (!client || !me) return;
    return act(
      "transport",
      async () => {
        const e = secureRng();
        const key: TrusteeKey = { v: 1, contextId, pollId, account: me, secret: encodeScalar(e) };
        if (!saveTrusteeKey(key)) throw new Error("this browser cannot store your trustee key (storage blocked)");
        setTrusteeKey(key);
        const [pub, proof] = makeTransportKey(pollId, me, e, secureRng);
        await client.publishTransportKey({ poll_id: pollId, key: encodePoint(pub), proof: branchToWire(proof) });
      },
      "Transport key published. Download the backup now — without it this browser is the only place your trustee key exists.",
    );
  }

  function publishDealing() {
    if (!client || !me || !ceremony) return;
    return act(
      "deal",
      async () => {
        const keys = ceremony.trustees.map((x) => decodePoint(x.transport!, "transport key"));
        // The polynomial lives only inside this call.
        const d = deal(pollId, me, t, keys, secureRng);
        await client.publishDealing({ poll_id: pollId, dealing: dealingToWire(d) });
      },
      "Shares dealt. Each trustee received one, encrypted to them alone.",
    );
  }

  function complain(dealer: string) {
    if (!client || !me || !trusteeKey || !ceremony) return;
    const w = ceremony.trustees.find((x) => x.account === dealer)?.dealing;
    if (!w) return;
    return act(
      `complain:${dealer}`,
      async () => {
        const [secret, proof] = makeComplaint(pollId, me, dealer, myIndex, decodeScalar(trusteeKey.secret), dealingFromWire(w), secureRng);
        await client.fileComplaint({ poll_id: pollId, dealer, secret: encodePoint(secret), proof: branchToWire(proof) });
      },
      `Complaint filed. It proves ${label(dealer)}'s share to you was bad, and their dealing will be left out of the key.`,
    );
  }

  function publishPartial() {
    if (!client || !me || !trusteeKey || !election) return;
    const secret = trusteeKey.secret;
    return act(
      "partial",
      async () => {
        const e = decodeScalar(secret, "trustee key");
        let x = 0n;
        for (const q of election.qualified) {
          const s = openShare(pollId, q.dealer, myIndex, e, dealingFromWire(q.dealing));
          if (s === null) {
            throw new Error(
              `${label(q.dealer)}'s share to you does not verify, so you cannot decrypt — any ${t} other trustees can.`,
            );
          }
          x += s;
        }
        const inputs = await client.tallyInputs({ poll_id: pollId });
        const partials = inputs.aggregate.map((ct, j) => {
          const [d, proof] = partialDecrypt(pollId, me, j, x, decodePoint(ct.a, "aggregate"), secureRng);
          return { d: encodePoint(d), proof: branchToWire(proof) };
        });
        await client.publishPartial({ poll_id: pollId, partials });
      },
      "Decryption share published. It decrypts only the per-option totals, never a single ballot.",
    );
  }

  async function restore(file: File) {
    if (!me) return;
    try {
      const k = parseTrusteeKey(await file.text(), { contextId, pollId, account: me });
      if (myTransport && encodePoint(BASE.multiply(decodeScalar(k.secret))) !== myTransport) {
        throw new Error("this key does not match the transport key you published");
      }
      saveTrusteeKey(k);
      setTrusteeKey(k);
      onNote("Trustee key restored into this browser.");
    } catch (e) {
      onError(errText(e));
    }
  }

  // ── render ───────────────────────────────────────────────────────────────

  const cell = (done: boolean, pending: string) => (done ? "✓" : pending);

  return (
    <div className="card">
      <h2>Trustees</h2>
      <p className="hint">
        {n === 1 ? (
          <>One trustee holds the whole decryption key — fine for a quick poll, not for a secret one.</>
        ) : (
          <>
            Any <strong className="text">{t}</strong> of these {n} can decrypt the totals together; fewer than {t}{" "}
            learn nothing, and no one ever holds the whole key.
          </>
        )}
      </p>
      <table>
        <thead>
          <tr>
            <th>trustee</th>
            <th>transport key</th>
            <th>shares dealt</th>
            <th>decryption</th>
          </tr>
        </thead>
        <tbody>
          {view.trustees.map((x) => (
            <tr key={x.account}>
              <td>
                {label(x.account)}
                {x.account === me && " (you)"}
              </td>
              <td>{cell(x.transport_published, "waiting")}</td>
              <td>
                {x.qualified === false
                  ? x.complaints_against > 0
                    ? "✗ disqualified"
                    : "— not in key"
                  : x.complaints_against > 0
                    ? `✗ ${x.complaints_against} complaint${x.complaints_against > 1 ? "s" : ""}`
                    : cell(x.dealing_published, phase === "KeyCeremony" ? "waiting" : "—")}
              </td>
              <td>{x.partial_published ? "✓" : phase === "Closed" ? "waiting" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {amTrustee && (
        <div className="trustee-box">
          {phase === "KeyCeremony" && !mine?.transport_published && (
            <>
              <p className="hint">
                Step 1 of 2: publish a transport key, so the other trustees can send you your share privately. Its
                secret stays in this browser.
              </p>
              <button onClick={() => void publishTransport()} disabled={!!busy}>
                {busy === "transport" ? "Publishing…" : "Publish my transport key"}
              </button>
            </>
          )}
          {phase === "KeyCeremony" && mine?.transport_published && !mine.dealing_published && (
            <>
              <p className="hint">
                Step 2 of 2: deal shares of a fresh random secret to every trustee.
                {!allTransport && " Waiting for every trustee's transport key."}
              </p>
              <button onClick={() => void publishDealing()} disabled={!!busy || !allTransport || !ceremony || !trusteeKey}>
                {busy === "deal" ? "Dealing…" : "Deal my key shares"}
              </button>
            </>
          )}
          {phase === "KeyCeremony" && received.length > 0 && (
            <ul className="received">
              {received.map((r) => (
                <li key={r.dealer} className={r.ok ? "ok" : "bad"}>
                  {r.ok ? "✓" : "✗"} share from {label(r.dealer)}
                  {!r.ok && !r.complained && (
                    <button className="ghost danger-text" onClick={() => void complain(r.dealer)} disabled={!!busy}>
                      File complaint
                    </button>
                  )}
                  {r.complained && <span className="empty"> — complaint filed</span>}
                </li>
              ))}
            </ul>
          )}
          {mine?.transport_published && !trusteeKey && !mine.partial_published && (
            <p className="hint warn">
              This browser does not hold your trustee key. Restore it from your backup file, or you cannot take part
              in the decryption.
            </p>
          )}
          <div className="row">
            {trusteeKey && (
              <button className="ghost" onClick={() => download(backupFileName(trusteeKey), JSON.stringify(trusteeKey, null, 2))}>
                Download key backup
              </button>
            )}
            {mine?.transport_published && !mine.partial_published && (
              <>
                <button className="ghost" onClick={() => restoreRef.current?.click()}>
                  Restore key from backup
                </button>
                <input
                  ref={restoreRef}
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])}
                />
              </>
            )}
          </div>
          {phase === "Closed" && !mine?.partial_published && trusteeKey && (
            <button onClick={() => void publishPartial()} disabled={!!busy}>
              {busy === "partial" ? "Decrypting…" : "Publish my decryption share"}
            </button>
          )}
        </div>
      )}

      {isCreator && phase === "KeyCeremony" && (
        <div className="row" style={{ marginTop: 12 }}>
          <button
            onClick={() => void act("open", () => client!.openVoting({ poll_id: pollId }), "Voting is open. The election key is frozen.")}
            disabled={!allTransport || qualifiedNow < t || !!busy}
          >
            {busy === "open" ? "Opening…" : "Open voting"}
          </button>
          <span className="empty">
            {!allTransport
              ? "Waiting for every trustee's transport key."
              : qualifiedNow < t
                ? `${qualifiedNow} honest dealing${qualifiedNow === 1 ? "" : "s"} so far; the key needs at least ${t}.`
                : qualifiedNow < n
                  ? `Ready. ${n - qualifiedNow} trustee${n - qualifiedNow === 1 ? " hasn't" : "s haven't"} dealt — waiting for them adds their randomness to the key.`
                  : "Every trustee has dealt."}
          </span>
        </div>
      )}
      {election && election.disqualified.length > 0 && (
        <p className="hint warn">
          Left out of the key by proven complaint: {election.disqualified.map(label).join(", ")}.
        </p>
      )}
      {election && phase !== "KeyCeremony" && (
        <p className="empty">
          Key from {election.qualified.length} dealing{election.qualified.length === 1 ? "" : "s"}:{" "}
          <code className="mono">{short(election.key)}</code>
        </p>
      )}
    </div>
  );
}
