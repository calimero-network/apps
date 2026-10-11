import { useEffect, useId, useState } from "react";
import type { FeedItem, TurnStep } from "./generated/HyperfeedClient";
import { progressLine } from "./format";
import "./WorkBlock.css";

/**
 * Your agent's turn on one of your messages, under the message.
 *
 * While it works: a "Working…" block with its steps as they happen (title,
 * status, time), the answer as it is written, and Stop. Collapsed, the block
 * shows the latest step; open, every step. Once the turn is over the steps
 * stay, folded away under "Worked · N steps".
 *
 * The steps and the answer so far come from the agent's `agent_work` reports
 * on the message; a feed or agent from before them shows its latest step
 * (`agent_progress`) instead.
 */
export function WorkBlock({
  item,
  clock,
  busy,
  onStop,
}: {
  /** One of your messages. */
  item: FeedItem;
  clock: () => number;
  busy: boolean;
  onStop: (id: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const working = item.status === "thinking";
  const steps = item.steps ?? [];
  const stopping = working && item.stop_at > 0;
  // Times move on while it works, even when no report arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 5_000);
    return () => window.clearInterval(t);
  }, [working]);

  if (item.kind !== "message" || item.from !== "you") return null;
  if (!working && steps.length === 0) return null;

  const now = clock();
  const last = steps[steps.length - 1];
  const latest = last ? stepLine(last, now) : progressLine(item, now);
  const label = working ? (stopping ? "Stopping…" : "Working…") : `Worked · ${steps.length} step${steps.length === 1 ? "" : "s"}`;

  return (
    <div className={`work${working ? " working" : ""}`}>
      <div className="work-head">
        <button
          type="button"
          className="work-toggle"
          aria-expanded={open}
          aria-controls={`${id}-steps`}
          disabled={steps.length === 0}
          onClick={() => setOpen(!open)}
        >
          <span className="work-label">{label}</span>
          {!open && (
            <span className="work-latest" role={working ? "status" : undefined}>
              {latest || "Your agent is on it…"}
            </span>
          )}
        </button>
        {working && (
          <button
            type="button"
            className="small work-stop"
            disabled={busy || stopping}
            onClick={() => onStop(item.id)}
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
      {open && steps.length > 0 && (
        <ol className="work-steps" id={`${id}-steps`} aria-label="Steps">
          {steps.map((s) => (
            <li key={s.id} className={`work-step ${s.status}`}>
              <span className="work-step-mark" aria-hidden="true">
                {MARKS[s.status] ?? "•"}
              </span>
              <span className="work-step-title">{s.title}</span>
              <span className="work-step-meta">
                {STATUS_WORDS[s.status] ?? s.status} · {ago(s.at, now)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {working && item.draft && (
        <div className="bubble from-agent work-draft" aria-live="off">
          <span className="sr-only">Your agent, writing:</span>
          <p>{item.draft}</p>
        </div>
      )}
    </div>
  );
}

const MARKS: Record<string, string> = { running: "◌", waiting: "⏸", done: "✓", failed: "✕" };
const STATUS_WORDS: Record<string, string> = {
  running: "running",
  waiting: "waiting for you",
  done: "done",
  failed: "failed",
};

/** One step, collapsed: "Running the tests · running · 12 s ago". */
export function stepLine(step: TurnStep, now: number): string {
  return `${step.title} · ${STATUS_WORDS[step.status] ?? step.status} · ${ago(step.at, now)}`;
}

function ago(at: number, now: number): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  return secs < 5 ? "just now" : secs < 60 ? `${secs} s ago` : `${Math.floor(secs / 60)} min ago`;
}
