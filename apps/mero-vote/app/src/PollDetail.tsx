import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditReport, PollView } from "./generated/MeroVoteClient";
import {
  ballotToWire,
  branchToWire,
  castBallot,
  decodePoint,
  decodeScalar,
  encodePoint,
  encodeScalar,
  makeKeyShare,
  partialDecrypt,
  secureRng,
} from "./crypto/protocol";
import { AuditPanel } from "./AuditPanel";
import { PhaseBadge } from "./VotePanel";
import { errText, short, useMeroVote } from "./useMeroVote";
import {
  backupFileName,
  loadTrusteeKey,
  parseTrusteeKey,
  saveTrusteeKey,
  type TrusteeKey,
} from "./utils/trusteeKeys";

const STEPS = ["KeyCeremony", "Voting", "Closed"] as const;
const STEP_LABEL = { KeyCeremony: "Key ceremony", Voting: "Voting", Closed: "Tally" };

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PollDetail({
  contextId,
  pollId,
  me,
  label,
  tick,
  onBack,
}: {
  contextId: string;
  pollId: string;
  me: string | null;
  label: (account: string) => string;
  tick: number;
  onBack: () => void;
}) {
  const client = useMeroVote(contextId);
  const [view, setView] = useState<PollView | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [trusteeKey, setTrusteeKey] = useState<TrusteeKey | null>(null);
  const [selection, setSelection] = useState<boolean[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const v = await client.getPoll({ poll_id: pollId });
      setView(v);
      setSelection((s) => (s.length === v.definition.options.length ? s : v.definition.options.map(() => false)));
      if (v.state.phase === "Closed") setReport(await client.getResult({ poll_id: pollId }));
      else setReport(null);
    } catch (e) {
      setErr(errText(e));
    }
  }, [client, pollId]);

  useEffect(() => void load(), [load, tick]);
  useEffect(() => {
    if (me) setTrusteeKey(loadTrusteeKey(contextId, pollId, me));
  }, [contextId, pollId, me]);

  async function act(name: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(name);
    setErr(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!view) {
    return (
      <div className="card">
        <button className="ghost" onClick={onBack}>
          ← All polls
        </button>
        <p className="empty">{err ?? "Loading poll…"}</p>
      </div>
    );
  }

  const def = view.definition;
  const phase = view.state.phase;
  const isCreator = me === def.creator;
  const amTrustee = !!me && def.trustees.includes(me);
  const myStatus = view.trustees.find((t) => t.account === me);
  const allShares = view.trustees.every((t) => t.share_published);
  const chosen = selection.filter(Boolean).length;
  const single = def.min_choices === 1 && def.max_choices === 1;
  const ruleText = single
    ? "Pick exactly one."
    : def.min_choices === 0
      ? `Pick up to ${def.max_choices}.`
      : `Pick between ${def.min_choices} and ${def.max_choices}.`;
  const counted = view.state.closure?.counted ?? [];
  const myCounted = !!view.my_digest && counted.some((c) => c.digest === view.my_digest);

  // ── actions (all crypto happens here, in the browser) ────────────────────

  function publishShare() {
    if (!client || !me) return;
    return act(
      "share",
      async () => {
        const x = secureRng();
        const key: TrusteeKey = { v: 1, contextId, pollId, account: me, secret: encodeScalar(x) };
        if (!saveTrusteeKey(key)) throw new Error("this browser cannot store your trustee key (storage blocked)");
        setTrusteeKey(key);
        const [h, proof] = makeKeyShare(pollId, me, x, secureRng);
        await client.publishKeyShare({ poll_id: pollId, share: encodePoint(h), proof: branchToWire(proof) });
      },
      "Key share published. Download the backup now — without it this poll cannot be counted if this browser's storage is lost.",
    );
  }

  function cast() {
    if (!client || !me || !view?.state.election) return;
    const key = view.state.election.key;
    return act(
      "cast",
      async () => {
        const pk = decodePoint(key, "election key");
        const rules = { options: def.options.length, min: def.min_choices, max: def.max_choices };
        const ballot = castBallot(pk, pollId, me, rules, selection, secureRng);
        await client.castBallot({ poll_id: pollId, ballot: ballotToWire(ballot) });
        // Forget the plaintext: nothing in this tab should outlive the vote.
        setSelection(def.options.map(() => false));
      },
      "Ballot cast. It left this browser encrypted — your node and every other member see only ciphertexts and proofs.",
    );
  }

  function publishPartial() {
    if (!client || !me || !trusteeKey) return;
    const secret = trusteeKey.secret;
    return act(
      "partial",
      async () => {
        const x = decodeScalar(secret, "trustee key");
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
      const x = decodeScalar(k.secret);
      const [h] = makeKeyShare(pollId, me, x, () => 1n);
      const published = view?.state.election?.shares.find((s) => s.trustee === me)?.share;
      if (published && published !== encodePoint(h)) throw new Error("this key does not match the share you published");
      saveTrusteeKey(k);
      setTrusteeKey(k);
      setNote("Trustee key restored into this browser.");
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="ghost" onClick={onBack}>
            ← All polls
          </button>
          <PhaseBadge phase={phase} />
        </div>
        <h2 className="poll-heading">{def.title}</h2>
        {def.description && <p className="desc">{def.description}</p>}
        <p className="empty">
          Created by {label(def.creator)} · {ruleText}{" "}
          {def.voters.length === 0 ? "Every member can vote." : `${def.voters.length} eligible voters.`}
          {def.closes_at ? ` Planned close ${new Date(def.closes_at).toLocaleString()}.` : ""}
        </p>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={s === phase ? "now" : STEPS.indexOf(phase) > i ? "done" : ""}>
              {STEP_LABEL[s]}
            </li>
          ))}
        </ol>
        {note && <p className="note">{note}</p>}
        {err && <pre className="err">{err}</pre>}
      </div>

      {/* ── trustees ─────────────────────────────────────────────────────── */}
      <div className="card">
        <h2>Trustees</h2>
        <table>
          <thead>
            <tr>
              <th>trustee</th>
              <th>key share</th>
              <th>decryption share</th>
            </tr>
          </thead>
          <tbody>
            {view.trustees.map((t) => (
              <tr key={t.account}>
                <td>
                  {label(t.account)}
                  {t.account === me && " (you)"}
                </td>
                <td>{t.share_published ? "✓ published" : "waiting"}</td>
                <td>{t.partial_published ? "✓ published" : phase === "Closed" ? "waiting" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {amTrustee && (
          <div className="trustee-box">
            {phase === "KeyCeremony" && !myStatus?.share_published && (
              <>
                <p className="hint">
                  You are a trustee. Generate your key share: the secret stays in this browser, and only its public
                  half and a proof you know it go to the context.
                </p>
                <button onClick={() => void publishShare()} disabled={!!busy}>
                  {busy === "share" ? "Publishing…" : "Generate & publish my key share"}
                </button>
              </>
            )}
            {myStatus?.share_published && !trusteeKey && !myStatus.partial_published && (
              <p className="hint warn">
                This browser does not hold your trustee key. Restore it from your backup file — the tally cannot
                complete without your decryption share.
              </p>
            )}
            <div className="row">
              {trusteeKey && (
                <button className="ghost" onClick={() => download(backupFileName(trusteeKey), JSON.stringify(trusteeKey, null, 2))}>
                  Download key backup
                </button>
              )}
              {myStatus?.share_published && !myStatus.partial_published && (
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
            {phase === "Closed" && !myStatus?.partial_published && trusteeKey && (
              <button onClick={() => void publishPartial()} disabled={!!busy}>
                {busy === "partial" ? "Decrypting…" : "Publish my decryption share"}
              </button>
            )}
          </div>
        )}

        {isCreator && phase === "KeyCeremony" && (
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => void act("open", () => client!.openVoting({ poll_id: pollId }), "Voting is open. The election key is frozen.")} disabled={!allShares || !!busy}>
              {busy === "open" ? "Opening…" : "Open voting"}
            </button>
            {!allShares && <span className="empty">Waiting for every trustee's key share.</span>}
          </div>
        )}
      </div>

      {/* ── ballot ───────────────────────────────────────────────────────── */}
      {phase === "Voting" && (
        <div className="card">
          <h2>{view.my_digest ? "Change your vote" : "Your ballot"}</h2>
          {view.can_vote ? (
            <>
              <p className="hint">{ruleText} Your choice is encrypted in this browser before it is sent.</p>
              <div className="options">
                {def.options.map((o, i) => (
                  <label key={i} className={`option ${selection[i] ? "on" : ""}`}>
                    <input
                      type={single ? "radio" : "checkbox"}
                      name="ballot"
                      checked={!!selection[i]}
                      onChange={() =>
                        setSelection(single ? def.options.map((_, j) => j === i) : selection.map((s, j) => (j === i ? !s : s)))
                      }
                    />
                    {o}
                  </label>
                ))}
              </div>
              <button
                onClick={() => void cast()}
                disabled={!!busy || chosen < def.min_choices || chosen > def.max_choices}
              >
                {busy === "cast" ? "Encrypting & proving…" : view.my_digest ? "Replace my ballot" : "Encrypt & cast ballot"}
              </button>
            </>
          ) : (
            <p className="empty">You are not on this poll's voter roll.</p>
          )}
          {view.my_digest && (
            <p className="receipt">
              Your receipt <code className="mono">{short(view.my_digest)}</code> — after the close, check it appears in
              the counted list.
            </p>
          )}
        </div>
      )}

      {/* ── turnout ──────────────────────────────────────────────────────── */}
      {phase !== "KeyCeremony" && (
        <div className="card">
          <h2>{phase === "Closed" ? `Counted ballots (${counted.length})` : `Turnout (${view.turnout.length})`}</h2>
          <p className="hint">Who voted is public. What they voted is not.</p>
          <div className="chips">
            {(phase === "Closed" ? counted.map((c) => c.voter) : view.turnout.map((t) => t.voter)).map((v) => (
              <span key={v} className="chip" title={v}>
                {label(v)}
                {v === me && " (you)"}
              </span>
            ))}
          </div>
          {phase === "Closed" && view.my_digest && (
            <p className={myCounted ? "note" : "hint warn"}>
              {myCounted
                ? `Your ballot ${short(view.my_digest)} is in the counted set.`
                : `Your latest ballot ${short(view.my_digest)} is NOT in the counted set — it reached the creator's node after the close.`}
            </p>
          )}
          {isCreator && phase === "Voting" && (
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="danger"
                onClick={() => void act("close", () => client!.closePoll({ poll_id: pollId }), "Poll closed. Trustees can now decrypt the totals.")}
                disabled={!!busy}
              >
                {busy === "close" ? "Closing…" : "Close poll"}
              </button>
              <span className="empty">Freezes the ballots your node has now. Late ballots are not counted.</span>
            </div>
          )}
        </div>
      )}

      {/* ── result & audit ───────────────────────────────────────────────── */}
      {phase === "Closed" && report && (
        <AuditPanel
          client={client}
          pollId={pollId}
          options={def.options}
          report={report}
          isCreator={isCreator}
          pending={view.trustees.filter((t) => !t.partial_published).map((t) => label(t.account))}
          onChanged={() => void load()}
          download={download}
        />
      )}
    </>
  );
}
