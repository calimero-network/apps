import { useState } from "react";
import type { AuditReport, MeroVoteClient } from "./generated/MeroVoteClient";
import { verifyTranscript, type LocalAudit } from "./crypto/verify";
import { errText, short } from "./useMeroVote";

/**
 * The result, and three ways of trusting it:
 *
 *  1. Your node re-verified every proof to produce it (`get_result`).
 *  2. This browser can re-verify it again from the raw transcript, with an
 *     independent implementation, and compare.
 *  3. The transcript digest can be published outside the context and recorded
 *     here, so people outside it can hold the result to that digest.
 */
export function AuditPanel({
  client,
  pollId,
  options,
  report,
  isCreator,
  pending,
  onChanged,
  download,
}: {
  client: MeroVoteClient | null;
  pollId: string;
  options: string[];
  report: AuditReport;
  isCreator: boolean;
  pending: string[];
  onChanged: () => void;
  download: (name: string, text: string) => void;
}) {
  const [local, setLocal] = useState<LocalAudit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [network, setNetwork] = useState("");
  const [reference, setReference] = useState("");

  const counts = report.counts;
  const total = counts ? counts.reduce((a, b) => a + b, 0) : 0;
  const max = counts ? Math.max(1, ...counts) : 1;

  async function reverify() {
    if (!client) return;
    setBusy("verify");
    setErr(null);
    try {
      const t = await client.getTranscript({ poll_id: pollId });
      // Yield so the button can repaint before a few thousand scalar mults.
      await new Promise((r) => setTimeout(r, 0));
      setLocal(verifyTranscript(t));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveTranscript() {
    if (!client) return;
    try {
      const t = await client.getTranscript({ poll_id: pollId });
      download(`mero-vote-transcript-${pollId.slice(0, 12)}.json`, JSON.stringify(t, null, 2));
    } catch (e) {
      setErr(errText(e));
    }
  }

  async function anchor() {
    if (!client) return;
    setBusy("anchor");
    setErr(null);
    try {
      await client.anchorResult({ poll_id: pollId, network: network.trim(), reference: reference.trim() });
      onChanged();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Result</h2>
        {counts ? (
          <div className="bars">
            {options.map((o, i) => (
              <div className="bar-row" key={i}>
                <span className="bar-label">{o}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(100 * counts[i]!) / max}%` }} />
                </span>
                <span className="bar-count">{counts[i]}</span>
              </div>
            ))}
            <p className="empty">
              {report.counted_ballots} ballot{report.counted_ballots === 1 ? "" : "s"} · {total} selection
              {total === 1 ? "" : "s"} · decrypted from the totals only
            </p>
          </div>
        ) : report.verified ? (
          <p className="empty">
            {report.counted_ballots} ballot{report.counted_ballots === 1 ? "" : "s"} counted. Waiting for {pending.length} trustee
            {pending.length === 1 ? "" : "s"} to publish a decryption share{pending.length ? `: ${pending.join(", ")}` : ""}.
          </p>
        ) : (
          <p className="hint warn">This poll does not verify — see the audit below. No result is shown for it.</p>
        )}
      </div>

      <div className="card">
        <h2>Audit</h2>
        <p className="hint">
          Your node recomputed all of this from the frozen ballots just now. Nothing here is a stored conclusion.
        </p>
        <CheckList checks={report.checks} />
        {report.transcript_digest && (
          <p className="empty">
            Transcript digest <code className="mono digest">{report.transcript_digest}</code>
          </p>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => void reverify()} disabled={!!busy}>
            {busy === "verify" ? "Re-verifying…" : "Re-verify in this browser"}
          </button>
          <button className="ghost" onClick={() => void saveTranscript()}>
            Download transcript
          </button>
        </div>
        {local && (
          <div className={`local-audit ${local.verified && local.agreesWithNode ? "ok" : "bad"}`}>
            <strong>
              {local.verified && local.agreesWithNode
                ? "✓ This browser independently reproduced the node's result."
                : local.agreesWithNode
                  ? "✗ The poll does not verify here either."
                  : "✗ This browser disagrees with the node."}
            </strong>
            <CheckList checks={local.checks} />
          </div>
        )}
        {err && <pre className="err">{err}</pre>}
      </div>

      {(report.anchor || (isCreator && counts)) && (
        <div className="card">
          <h2>Public anchor</h2>
          {report.anchor ? (
            <p className="empty">
              Digest <code className="mono">{short(report.anchor.digest)}</code> anchored on{" "}
              <strong className="text">{report.anchor.network}</strong>: <code className="mono">{report.anchor.reference}</code>
            </p>
          ) : (
            <>
              <p className="hint">
                Publish the transcript digest somewhere outside this context — a transaction memo, a signed git tag, a
                post — then record where. Anyone given the transcript can then check it against that public digest.
              </p>
              <div className="row">
                <input placeholder="network (e.g. ethereum:sepolia, git, web)" value={network} onChange={(e) => setNetwork(e.target.value)} />
                <input placeholder="reference (tx hash, URL, tag)" value={reference} onChange={(e) => setReference(e.target.value)} />
                <button onClick={() => void anchor()} disabled={!network.trim() || !reference.trim() || !!busy}>
                  Record anchor
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function CheckList({ checks }: { checks: { name: string; ok: boolean; detail: string }[] }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.name} className={c.ok ? "ok" : "bad"}>
          <span className="mark">{c.ok ? "✓" : "✗"}</span>
          <span className="name">{c.name}</span>
          <span className="detail">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}
