import { useCallback, useEffect, useState } from "react";
import type { AuditReport, PollView } from "./generated/MeroVoteClient";
import { ballotToWire, castBallot, decodePoint, secureRng } from "./crypto/protocol";
import { AuditPanel } from "./AuditPanel";
import { PhaseBadge } from "./VotePanel";
import { errText, short, useMeroVote } from "./useMeroVote";
import { TrusteePanel } from "./TrusteePanel";
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  LockIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
} from "./icons";
import { Callout, IconTile, IdField } from "./ui";

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
        <button className="plain sm" onClick={onBack}>
          <ArrowLeftIcon size={14} />
          All polls
        </button>
        <p className="empty" style={{ marginTop: 12 }}>{err ?? "Loading poll…"}</p>
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

  // Trustees matter most during the ceremony and while the totals still await
  // decryption; once there is a ballot to cast or a result to read, they move down.
  const trusteesLast = phase === "Voting" || phase === "Closing" || (phase === "Closed" && !!report?.counts);
  const voterList = phase === "Closed" ? counted.map((c) => c.voter) : view.turnout.map((t) => t.voter);

  return (
    <>
      <div className="card">
        <div className="poll-top">
          <button className="plain sm" onClick={onBack} style={{ marginLeft: -8 }}>
            <ArrowLeftIcon size={14} />
            All polls
          </button>
          <PhaseBadge phase={phase} />
        </div>
        <h2 className="poll-heading">{def.title}</h2>
        {def.description && <p className="desc">{def.description}</p>}
        <ul className="facts">
          <li>
            <UserIcon size={14} />
            Created by {label(def.creator)}
          </li>
          <li>
            <CheckIcon size={14} />
            {ruleText}
          </li>
          <li>
            <UsersIcon size={14} />
            {def.voters.length === 0 ? "Every member can vote." : `${def.voters.length} eligible voters.`}
          </li>
          {def.closes_at ? (
            <li>
              <CalendarIcon size={14} />
              Planned close {new Date(def.closes_at).toLocaleString()}
            </li>
          ) : null}
        </ul>
        <ol className="steps" aria-label="Poll progress">
          {STEPS.map((s, i) => {
            const done = STEPS.indexOf(phase) > i;
            return (
              <li key={s} className={s === phase ? "now" : done ? "done" : ""} aria-current={s === phase ? "step" : undefined}>
                <span className="step-dot">{done ? <CheckIcon size={12} strokeWidth={2.5} /> : i + 1}</span>
                <span className="step-label">{STEP_LABEL[s]}</span>
              </li>
            );
          })}
        </ol>
        {note && (
          <Callout tone="success" icon={<CheckIcon size={18} />}>
            {note}
          </Callout>
        )}
        {err && <pre className="err">{err}</pre>}
      </div>

      {/*
        One position in the tree (so it never remounts), but painted after the
        ballot and the result while those are what the poll is about. The
        parent column is a grid, so `order` moves it without moving the node.
      */}
      <div className="stack" style={{ order: trusteesLast ? 1 : 0 }}>
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
      </div>

      {/* ── ballot ───────────────────────────────────────────────────────── */}
      {phase === "Voting" && (
        <div className="card">
          <div className="card-head">
            <IconTile accent>
              <LockIcon size={18} />
            </IconTile>
            <div className="grow">
              <h2>{view.my_digest ? "Change your vote" : "Your ballot"}</h2>
              {view.can_vote && (
                <div className="meta">{ruleText} Your choice is encrypted in this browser before it is sent.</div>
              )}
            </div>
          </div>
          {view.can_vote ? (
            <>
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
              <div className="ballot-foot">
                <button
                  className="lg"
                  onClick={() => void cast()}
                  disabled={!!busy || chosen < def.min_choices || chosen > def.max_choices}
                >
                  <LockIcon size={16} />
                  {busy === "cast" ? "Encrypting & proving…" : view.my_digest ? "Replace my ballot" : "Encrypt & cast ballot"}
                </button>
                <span className="empty">
                  <ShieldCheckIcon size={14} />
                  Encrypted and proven well-formed before it leaves this tab
                </span>
              </div>
            </>
          ) : (
            <p className="empty">You are not on this poll's voter roll.</p>
          )}
          {view.my_digest && (
            <p className="receipt">
              Your receipt <IdField value={view.my_digest} label="receipt" /> — after the close, check it appears in
              the counted list.
            </p>
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

      {/* ── turnout ──────────────────────────────────────────────────────── */}
      {phase !== "KeyCeremony" && (
        <div className="card">
          <div className="card-head">
            <div className="grow">
              <h2>{phase === "Closed" ? `Counted ballots (${counted.length})` : `Turnout (${view.turnout.length})`}</h2>
              <div className="meta">Who voted is public. What they voted is not.</div>
            </div>
            <UsersIcon size={16} className="muted" />
          </div>
          {voterList.length === 0 ? (
            <p className="empty">No ballots yet.</p>
          ) : (
            <div className="chips">
              {voterList.map((v) => (
                <span key={v} className="chip" title={v} data-testid="voter">
                  <span className={`avatar ${v === me ? "me" : ""}`}>{label(v).slice(0, 1)}</span>
                  {label(v)}
                  {v === me && <span className="you">(you)</span>}
                </span>
              ))}
            </div>
          )}
          {phase === "Closed" && view.my_digest && (
            <Callout tone={myCounted ? "success" : "warning"} icon={myCounted ? <CheckIcon size={18} /> : undefined}>
              {myCounted
                ? `Your ballot ${short(view.my_digest)} is in the counted set.`
                : `Your latest ballot ${short(view.my_digest)} is NOT in the counted set — it reached the creator's node after the seal.`}
            </Callout>
          )}
          {phase === "Closing" && (
            <Callout tone="info" icon={<ClockIcon size={18} />}>
              Closing: nodes refuse new ballots as soon as they see the close, but ballots cast before that are still
              arriving. {isCreator ? "Seal once everyone's nodes have caught up." : "The creator seals the count next."}
            </Callout>
          )}
          {isCreator && phase === "Voting" && (
            <div className="creator-bar">
              <span className="empty">Stops new ballots. The count is frozen in the next step.</span>
              <button
                className="danger"
                onClick={() => void act("close", () => client!.closePoll({ poll_id: pollId }), "Poll closed to new ballots. Seal the count once ballots in flight have arrived.")}
                disabled={!!busy}
              >
                {busy === "close" ? "Closing…" : "Close poll"}
              </button>
            </div>
          )}
          {isCreator && phase === "Closing" && (
            <div className="creator-bar">
              <span className="empty">Freezes the ballots your node holds now.</span>
              <button
                className="danger"
                onClick={() => void act("seal", () => client!.sealPoll({ poll_id: pollId }), "Count sealed. Trustees can now decrypt the totals.")}
                disabled={!!busy}
              >
                <LockIcon size={16} />
                {busy === "seal" ? "Sealing…" : "Seal the count"}
              </button>
            </div>
          )}
        </div>
      )}

    </>
  );
}
