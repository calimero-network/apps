import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { usePlayerTime, type PlayerState } from "./usePlayer";
import { formatClock } from "./lib/transcript";
import { nextRate, speakerColor, type Lane } from "./lib/playback";
import { Icon } from "./ui";
import "./playback.css";


/** The player bar: play, skip, speed, the scrubber with each speaker's stretches, and Follow. */
export function Player({
  player,
  src,
  loading,
  error,
  fallbackDurationMs,
  lanes,
  nameOf,
  follow,
  onFollow,
}: {
  player: PlayerState;
  src: string | null;
  loading: boolean;
  error: string | null;
  /** The meeting's length, until the audio says its own. */
  fallbackDurationMs: number;
  lanes: Lane[];
  nameOf: (label: string) => string;
  follow: boolean;
  onFollow: (on: boolean) => void;
}) {
  const { bind, playing, rate, seek, toggle, skip, setRate } = player;
  const timeMs = usePlayerTime(player);
  const problem = error ?? (player.error ? `The recording did not play: ${player.error}.` : null);
  const duration = player.durationMs || fallbackDurationMs || 1;
  const progress = Math.min(1, Math.max(0, timeMs / duration));
  const scrub = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const seekAt = (clientX: number) => {
    const el = scrub.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    seek(f * duration);
  };

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointerdown") {
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (dragging.current) seekAt(e.clientX);
    if (e.type === "pointerup" || e.type === "pointercancel") dragging.current = false;
  };

  const onScrubKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") skip(-5_000);
    else if (e.key === "ArrowRight") skip(5_000);
    else if (e.key === "Home") seek(0);
    else if (e.key === "End") seek(duration);
    else return;
    e.preventDefault();
  };

  // Space plays and pauses anywhere on the page that is not a field or a button.
  useEffect(() => {
    if (!src) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== " " || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, button, [contenteditable], [role=slider]") || t.isContentEditable)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, toggle]);

  const ready = !!src && !problem;
  return (
    <section className="card player" aria-label="Recording">
      {src && <audio {...bind} src={src} preload="metadata" />}
      <div className="player-row">
        <button
          type="button"
          className="player-play"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
        >
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={() => skip(-10_000)} disabled={!ready} aria-label="Back 10 seconds" title="Back 10 s">
          <Icon name="back" />
        </button>
        <button type="button" className="icon-btn" onClick={() => skip(10_000)} disabled={!ready} aria-label="Forward 10 seconds" title="Forward 10 s">
          <Icon name="forward" />
        </button>
        <span className="player-time mono" aria-live="off">
          {formatClock(timeMs)} <span className="dim">/ {formatClock(duration)}</span>
        </span>
        <span className="player-spacer" />
        <button
          type="button"
          className="btn small ghost player-rate"
          onClick={() => setRate(nextRate(rate))}
          disabled={!ready}
          aria-label={`Playback speed ${rate}×`}
          title="Playback speed"
        >
          {rate}×
        </button>
        <button
          type="button"
          className={`btn small ghost player-follow${follow ? " on" : ""}`}
          aria-pressed={follow}
          onClick={() => onFollow(!follow)}
          title="Keep the line being said in view"
        >
          <Icon name="follow" size={14} /> Follow
        </button>
      </div>

      <div
        ref={scrub}
        className={`player-scrub${ready ? "" : " off"}`}
        role="slider"
        tabIndex={ready ? 0 : -1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(timeMs / 1000)}
        aria-valuetext={formatClock(timeMs)}
        onPointerDown={ready ? onPointer : undefined}
        onPointerMove={ready ? onPointer : undefined}
        onPointerUp={ready ? onPointer : undefined}
        onPointerCancel={ready ? onPointer : undefined}
        onKeyDown={ready ? onScrubKey : undefined}
      >
        <div className="player-lanes" style={{ gridTemplateRows: `repeat(${Math.max(1, lanes.length)}, 1fr)` }}>
          {lanes.map((lane, i) => (
            <div className="player-lane" key={lane.label} title={nameOf(lane.label)}>
              {lane.spans.map((s, j) => (
                <span
                  key={j}
                  className="player-span"
                  style={{ left: `${s.from * 100}%`, width: `${Math.max(0.3, (s.to - s.from) * 100)}%`, background: speakerColor(i) }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="player-played" style={{ width: `${progress * 100}%` }} />
        <div className="player-head" style={{ left: `${progress * 100}%` }} />
      </div>

      {lanes.length > 1 && (
        <ul className="player-legend" aria-label="Speakers">
          {lanes.map((lane, i) => (
            <li key={lane.label}>
              <span className="spk-dot" style={{ background: speakerColor(i) }} aria-hidden="true" />
              {nameOf(lane.label)}
            </li>
          ))}
        </ul>
      )}
      {loading && <p className="player-note dim">Loading the recording…</p>}
      {problem && (
        <p className="player-note err" role="alert">
          {error ? `The recording did not load: ${error}` : problem}
        </p>
      )}
    </section>
  );
}
