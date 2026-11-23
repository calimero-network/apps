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

  return (
    <main className="body">
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="rec-head">
          {status.phase === "stopping" ? <Spinner /> : <span className="rec-dot" aria-hidden="true" />}
          <span className="small muted" style={{ flex: 1 }}>
            {status.phase === "starting"
              ? "Starting…"
              : status.phase === "stopping"
                ? "Finishing the transcript…"
                : status.phase === "loading-model"
                  ? "Recording · getting the speech model ready"
                  : "Recording"}
          </span>
          <span className="timer" aria-live="off">
            {clock(elapsed)}
          </span>
        </div>
        <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {status.meeting?.title}
        </div>
        <div className="meters">
          <span className="who you">You</span>
          <Meter value={levels.you} who="you" />
          <span className="who others">Others</span>
          <Meter value={levels.others} who="others" />
        </div>
        {status.model && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="small muted">
              Downloading {tier?.name} · {Math.round(status.model.fraction * 100)}% — speech is kept until it's ready
            </span>
            <div className="progress">
              <span style={{ width: `${status.model.fraction * 100}%` }} />
            </div>
          </div>
        )}
      </section>

      <section className="card" aria-label="Latest lines" aria-live="polite">
        {status.lines.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            Lines appear here a few seconds after they are spoken.
          </p>
        ) : (
          <div className="lines">
            {status.lines.slice(-4).map((l, i) => (
              <div className="line" key={`${l.startMs}-${i}`}>
                <span className={`who ${l.speaker}`}>{l.speaker === "you" ? "You" : "Others"}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {status.notice && <div className="banner wait">{status.notice}</div>}
      {status.uploadError && <div className="banner wait">Saving is retrying: {status.uploadError}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={openPanel} disabled={tabId === null} style={{ flex: 1 }}>
          <PanelIcon size={16} /> Live transcript
        </button>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          onClick={() => void ask({ type: "stop" })}
          disabled={status.phase === "stopping" || status.phase === "starting"}
        >
          <StopIcon size={16} /> Stop
        </button>
      </div>
      <p className="small muted center" style={{ margin: 0 }}>
        {tier ? `${tier.name} · on this laptop` : ""}
        {status.pending > 0 ? ` · ${status.pending} lines saving` : ""}
      </p>
    </main>
  );
}
