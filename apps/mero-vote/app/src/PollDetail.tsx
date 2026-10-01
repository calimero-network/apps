import { useCallback, useEffect, useState } from "react";
import type { AuditReport, PollView } from "./generated/MeroVoteClient";
import { ballotToWire, castBallot, decodePoint, secureRng } from "./crypto/protocol";
import { AuditPanel } from "./AuditPanel";
import { PhaseBadge } from "./VotePanel";
import { errText, short, useMeroVote } from "./useMeroVote";
import { TrusteePanel } from "./TrusteePanel";

const STEPS = ["KeyCeremony", "Voting", "Closing", "Closed"] as const;
const STEP_LABEL = { KeyCeremony: "Key ceremony", Voting: "Voting", Closing: "Closing", Closed: "Tally" };

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
  const [selection, setSelection] = useState<boolean[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

      <TrusteePanel
        client={client}
        contextId={contextId}
        view={view}
        me={me}
        label={label}
        isCreator={isCreator}
        busy={busy}
        act={act}
        onNote={setNote}
        onError={setErr}
        download={download}
      />

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
                : `Your latest ballot ${short(view.my_digest)} is NOT in the counted set — it reached the creator's node after the seal.`}
            </p>
          )}
          {phase === "Closing" && (
            <p className="hint">
              Closing: nodes refuse new ballots as soon as they see the close, but ballots cast before that are still
              arriving. {isCreator ? "Seal once everyone's nodes have caught up." : "The creator seals the count next."}
            </p>
          )}
          {isCreator && phase === "Voting" && (
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="danger"
                onClick={() => void act("close", () => client!.closePoll({ poll_id: pollId }), "Poll closed to new ballots. Seal the count once ballots in flight have arrived.")}
                disabled={!!busy}
              >
                {busy === "close" ? "Closing…" : "Close poll"}
              </button>
              <span className="empty">Stops new ballots. The count is frozen in the next step.</span>
            </div>
          )}
          {isCreator && phase === "Closing" && (
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="danger"
                onClick={() => void act("seal", () => client!.sealPoll({ poll_id: pollId }), "Count sealed. Trustees can now decrypt the totals.")}
                disabled={!!busy}
              >
                {busy === "seal" ? "Sealing…" : "Seal the count"}
              </button>
              <span className="empty">Freezes the ballots your node holds now.</span>
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
          threshold={def.threshold}
          published={view.trustees.filter((t) => t.partial_published).length}
          label={label}
          onChanged={() => void load()}
          download={download}
        />
      )}
    </>
  );
}
