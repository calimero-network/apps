import type { RecorderStatus } from "../../lib/messages";
import { TIERS } from "../../lib/tiers";
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
