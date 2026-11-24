import { useEffect, useRef } from "react";
import { group } from "../../lib/format";
import { IDLE, KEYS, type Line, type RecorderStatus } from "../../lib/messages";
import { clock, useStored } from "../hooks";
import { ExternalIcon, Mark, WaveIcon } from "../icons";

export function App() {
  const lines = useStored<Line[]>("session", KEYS.transcript) ?? [];
  const status = useStored<RecorderStatus>("session", KEYS.status) ?? IDLE;
  const end = useRef<HTMLDivElement>(null);
  const live = status.phase === "recording" || status.phase === "loading-model";

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [lines.length]);

  const utterances = group(lines);

  return (
    <div className="panel-shell">
      <header className="top">
        <Mark size={22} />
        <span className="grow" style={{ lineHeight: 1.3 }}>
          <span className="brand truncate">{status.meeting?.title ?? "Live transcript"}</span>
          <span className="small muted hstack" style={{ gap: 6 }}>
            {live && <span className="rec-dot" aria-hidden="true" />}
            {live ? "Recording" : status.phase === "saved" ? "Saved" : status.phase === "stopping" ? "Finishing…" : "Not recording"}
          </span>
        </span>
        {status.link && (
          <button className="icon-btn" aria-label="Open in Minutes" onClick={() => void chrome.tabs.create({ url: status.link! })}>
            <ExternalIcon size={15} />
          </button>
        )}
      </header>
      <main className="transcript" aria-live="polite">
        {utterances.length === 0 ? (
          <div className="empty">
            <span className="tile lg"><WaveIcon size={20} /></span>
            <span>{live ? "Listening… the first lines appear a few seconds after someone speaks." : "Start a recording from the Minutes button to see the transcript here."}</span>
          </div>
        ) : (
          utterances.map((u, i) => (
            <div className="utterance" key={`${u.startMs}-${i}`}>
              <span className="head">
                <span className={`who ${u.speaker}`}>{u.speaker === "you" ? "You" : "Others"}</span>
                <span className="stamp">{clock(Math.floor(u.startMs / 1000))}</span>
              </span>
              <span>{u.text}</span>
            </div>
          ))
        )}
        <div ref={end} />
      </main>
    </div>
  );
}
