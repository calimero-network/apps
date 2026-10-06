import { useState } from "react";
import type { AuditReport, MeroVoteClient } from "./generated/MeroVoteClient";
import { verifyTranscript, type LocalAudit } from "./crypto/verify";
import { errText, short } from "./useMeroVote";
import {
  AnchorIcon,
  BarChartIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  ShieldCheckIcon,
  XIcon,
} from "./icons";
import { Callout, CopyButton, IconTile } from "./ui";

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
  threshold,
  published,
  label,
  onChanged,
  download,
}: {
  client: MeroVoteClient | null;
  pollId: string;
  options: string[];
  report: AuditReport;
  isCreator: boolean;
  threshold: number;
  published: number;
  label: (account: string) => string;
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
  // Share of counted ballots (approval polls can sum past 100%).
  const denom = report.counted_ballots > 0 ? report.counted_ballots : Math.max(total, 1);
  const top = counts ? Math.max(...counts) : 0;
  const pct = (c: number) => Math.round((100 * c) / denom);

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
        <div className="card-head">
          <IconTile accent={!!counts}>
            <BarChartIcon size={18} />
          </IconTile>
          <div className="grow">
            <h2>Result</h2>
            {counts && (
              <div className="meta tnum">
                {report.counted_ballots} ballot{report.counted_ballots === 1 ? "" : "s"} · {total} selection
                {total === 1 ? "" : "s"}
              </div>
            )}
          </div>
          {report.verified && (
            <span className="badge success">
              <ShieldCheckIcon size={12} />
              Verified
            </span>
          )}
        </div>
        {counts ? (
          <div className="bars">
            {options.map((o, i) => {
              const winner = top > 0 && counts[i] === top;
              return (
                <div className={`bar-row ${winner ? "winner" : ""}`} key={i} data-testid="result-row">
                  <span className="bar-label" title={o}>
                    {o}
                    {winner && <span className="badge">Most votes</span>}
                  </span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${Math.min(100, (100 * counts[i]!) / Math.max(denom, max))}%` }} />
                  </span>
                  <span className="bar-count" data-testid="result-count">{counts[i]}</span>
                  <span className="bar-pct">{pct(counts[i]!)}%</span>
                </div>
              );
            })}
            <p className="result-foot">
              Decrypted from the totals only, by {report.decrypted_by.map(label).join(" + ")}. No single ballot was
              ever decrypted.
            </p>
          </div>
        ) : report.verified ? (
          <Callout tone="info" icon={<ClockIcon size={18} />}>
            {report.counted_ballots} ballot{report.counted_ballots === 1 ? "" : "s"} counted. {published} of the{" "}
            {threshold} decryption share{threshold === 1 ? "" : "s"} needed are in.
          </Callout>
        ) : (
          <Callout tone="danger">This poll does not verify — see the audit below. No result is shown for it.</Callout>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <IconTile>
            <ShieldCheckIcon size={18} />
          </IconTile>
          <div className="grow">
            <h2>Audit</h2>
            <div className="meta">
              Your node recomputed all of this from the frozen ballots just now. Nothing here is a stored conclusion.
            </div>
          </div>
        </div>
        {report.verified ? (
          <Callout tone="success">
            <strong>Every check passed</strong>
            <p>The node re-verified every proof, from the key ceremony to the decryption.</p>
          </Callout>
        ) : (
          <Callout tone="danger">
            <strong>This poll does not verify</strong>
            <p>At least one check below failed. A poll is only as good as its worst check.</p>
          </Callout>
        )}
        <CheckList checks={report.checks} />
        {report.uncounted.length > 0 && (
          <Callout tone="warning">
            Not in the sealed count: {report.uncounted.map(label).join(", ")} — their ballot reached this node after
            the seal, or the creator left it out.
          </Callout>
        )}
        {report.transcript_digest && (
          <div className="digest-row">
            <span>Transcript digest</span>
            <span className="id-field" title={report.transcript_digest}>
              <code className="mono digest">{report.transcript_digest}</code>
              <CopyButton value={report.transcript_digest} label="Copy transcript digest" />
            </span>
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={() => void reverify()} disabled={!!busy}>
            <ShieldCheckIcon size={16} />
            {busy === "verify" ? "Re-verifying…" : "Re-verify in this browser"}
          </button>
          <button className="ghost" onClick={() => void saveTranscript()}>
            <DownloadIcon size={16} />
            Download transcript
          </button>
        </div>
        {local && (
          <div className={`local-audit ${local.verified && local.agreesWithNode ? "ok" : "bad"}`}>
            <Callout tone={local.verified && local.agreesWithNode ? "success" : "danger"}>
              <strong>
                {local.verified && local.agreesWithNode
                  ? "This browser independently reproduced the node's result."
                  : local.agreesWithNode
                    ? "The poll does not verify here either."
                    : "This browser disagrees with the node."}
              </strong>
              <p>Checked from the raw transcript with an independent implementation.</p>
            </Callout>
            <CheckList checks={local.checks} />
          </div>
        )}
        {err && <pre className="err">{err}</pre>}
      </div>

      {(report.anchor || (isCreator && counts)) && (
        <div className="card">
          <div className="card-head">
            <IconTile>
              <AnchorIcon size={18} />
            </IconTile>
            <div className="grow">
              <h2>Public anchor</h2>
              {!report.anchor && (
                <div className="meta">Hold the result to a digest published outside this context.</div>
              )}
            </div>
          </div>
          {report.anchor ? (
            <dl className="kv">
              <dt>Digest</dt>
              <dd>
                <code className="mono" title={report.anchor.digest}>{short(report.anchor.digest)}</code>
              </dd>
              <dt>Network</dt>
              <dd>
                <strong className="text">{report.anchor.network}</strong>
              </dd>
              <dt>Reference</dt>
              <dd>
                <code className="mono" title={report.anchor.reference}>{report.anchor.reference}</code>
              </dd>
            </dl>
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
          <span className="mark" role="img" aria-label={c.ok ? "passed" : "failed"}>
            {c.ok ? <CheckIcon size={16} /> : <XIcon size={16} />}
          </span>
          <span className="name">{c.name}</span>
          <span className="detail">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}
