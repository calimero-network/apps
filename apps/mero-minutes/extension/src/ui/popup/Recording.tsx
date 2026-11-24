import type { RecorderStatus } from "../../lib/messages";
import { TIERS } from "../../lib/tiers";
import { NOTES_MODELS } from "../../lib/notes";
import { clock, useElapsed, useLevels } from "../hooks";
import { PanelIcon, Spinner, StopIcon } from "../icons";
import { ask } from "../rpc";

function Meter({ value, who }: { value: number; who: "you" | "others" }) {
  // Speech sits around 0.02–0.2 RMS; a square root spreads it over the bar.
  const pct = Math.min(100, Math.round(Math.sqrt(Math.min(1, value * 4)) * 100));
  return (
    <div className={`meter ${who}`} role="meter" aria-label={who === "you" ? "You" : "Others"} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Recording({ status, tabId }: { status: RecorderStatus; tabId: number | null }) {
  const elapsed = useElapsed(status.meeting?.startedAt);
  const levels = useLevels();
  const tier = status.tier ? TIERS[status.tier] : null;
  const openPanel = () => {
    if (tabId !== null) void chrome.sidePanel.open({ tabId });
  };
  if (status.phase === "notes") return <WritingNotes status={status} />;
  const label =
    status.phase === "starting"
      ? "Starting…"
      : status.phase === "stopping"
        ? "Finishing the transcript…"
        : status.phase === "loading-model"
          ? "Recording · preparing the model"
          : "Recording";

  return (
    <main className="body">
      <section className="card stack" style={{ gap: 16, padding: 16 }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="hstack small muted">
            {status.phase === "stopping" || status.phase === "starting" ? (
              <Spinner size={12} />
            ) : (
              <span className="rec-dot" aria-hidden="true" />
            )}
            {label}
          </span>
          <span className="timer" aria-live="off">
            {clock(elapsed)}
          </span>
          <span className="strong truncate">{status.meeting?.title}</span>
        </div>
        <hr className="divider" />
        <div className="meters">
          <span className="who you">You</span>
          <Meter value={levels.you} who="you" />
          <span className="who">Others</span>
          <Meter value={levels.others} who="others" />
        </div>
        {status.model && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="small muted">
              Downloading {tier?.name} · {Math.round(status.model.fraction * 100)}% — speech is kept until it's ready
            </span>
            <div className="progress">
              <span style={{ width: `${status.model.fraction * 100}%` }} />
            </div>
          </div>
        )}
      </section>

      <section className="stack" aria-label="Latest lines" aria-live="polite" style={{ gap: 8, padding: "0 4px" }}>
        <span className="label">Latest</span>
        {status.lines.length === 0 ? (
          <p className="small muted">Lines appear here a few seconds after they are spoken.</p>
        ) : (
          <div className="lines">
            {status.lines.slice(-3).map((l, i) => (
              <div className="line" key={`${l.startMs}-${i}`}>
                <span className={`who ${l.speaker}`}>{l.speaker === "you" ? "You" : "Others"}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {status.notice && <div className="banner">{status.notice}</div>}
      {status.uploadError && <div className="banner">Saving is retrying: {status.uploadError}</div>}

      <div className="stack" style={{ marginTop: "auto", gap: 12 }}>
        <div className="hstack">
          <button className="btn lg grow" onClick={openPanel} disabled={tabId === null}>
            <PanelIcon size={15} /> Live transcript
          </button>
          <button
            className="btn primary lg grow"
            onClick={() => void ask({ type: "stop" })}
            disabled={status.phase === "stopping" || status.phase === "starting"}
          >
            <StopIcon size={14} /> Stop
          </button>
        </div>
        <p className="foot">
          {tier ? `${tier.name} · on this laptop` : ""}
          {status.pending > 0 ? ` · ${status.pending} lines saving` : ""}
        </p>
      </div>
    </main>
  );
}

/** After the transcript: the model on this laptop writes the summary and action items. */
function WritingNotes({ status }: { status: RecorderStatus }) {
  const n = status.notes;
  const model = n ? NOTES_MODELS[n.model] : null;
  const pct = n ? Math.round(n.fraction * 100) : 0;
  return (
    <main className="body">
      <section className="card stack" style={{ gap: 12, padding: 16 }} aria-live="polite">
        <span className="hstack small muted">
          <Spinner size={12} />
          {n?.step === "download" ? "Downloading the notes model" : "Writing the summary and action items"}
        </span>
        <span className="strong truncate">{status.meeting?.title}</span>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-label="Notes">
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="small muted">
          {model ? `${model.name} on this laptop` : "On this laptop"}
          {n?.step === "download" ? ` · ${pct}% of ${model ? Math.round(model.sizeMb) : "?"} MB, once` : ""}. The transcript is
          saved; you can close this.
        </span>
      </section>
    </main>
  );
}
