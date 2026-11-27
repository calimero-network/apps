import { useState, type CSSProperties } from "react";
import { formatShare, type TalkStats } from "./lib/stats";
import { speakerColor } from "./lib/playback";
import { formatClock, formatDuration } from "./lib/transcript";
import { Icon } from "./ui";
import "./playback.css";

/**
 * Who talked and how much, compactly: the share bar (a segment per speaker,
 * click one to pick them), a row of speaker tabs with their share, and the
 * picked speaker's numbers as small tiles. A speaker can be given a name
 * (`Speaker 1` → `Eve`) by whoever may edit the meeting.
 */
export function SpeakersCard({
  stats,
  nameOf,
  canRename,
  onRename,
  onSeek,
}: {
  stats: TalkStats;
  nameOf: (label: string) => string;
  canRename: boolean;
  onRename: (label: string, name: string) => Promise<unknown>;
  /** Jump to where a speaker first spoke. */
  onSeek?: (ms: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState(0);
  if (stats.speakers.length === 0) return null;
  const at = Math.min(picked, stats.speakers.length - 1);
  const s = stats.speakers[at]!;
  const tiles: [string, string][] = [
    ["Talked", formatDuration(s.talkMs)],
    ["Words", s.words.toLocaleString()],
    ["Turns", s.turns.toLocaleString()],
    ["Longest", formatDuration(s.longestTurnMs)],
    ["Pace", s.wpm ? `${s.wpm} wpm` : "—"],
    ["Questions", s.questions.toLocaleString()],
  ];

  return (
    <section className="card talk-card" aria-labelledby="talk-title">
      <div className="card-head">
        <h2 id="talk-title">Talk time</h2>
        <span className="dim">{formatDuration(stats.totalTalkMs)} of speech</span>
      </div>

      <div className="talk-bar" aria-label={stats.speakers.map((x) => `${nameOf(x.label)} ${formatShare(x.share)}`).join(", ")}>
        {stats.speakers.map((x, i) => (
          <button
            key={x.label}
            type="button"
            tabIndex={-1}
            className={i === at ? "on" : ""}
            style={{ flexGrow: Math.max(x.share, 0.001), "--spk": speakerColor(i), "--i": i } as CSSProperties}
            title={`${nameOf(x.label)}: ${formatShare(x.share)}`}
            aria-label={`${nameOf(x.label)}: ${formatShare(x.share)}`}
            onClick={() => setPicked(i)}
          />
        ))}
      </div>

      <div className="talk-tabs" role="tablist" aria-label="Speakers">
        {stats.speakers.map((x, i) => (
          <div key={x.label} className={i === at ? "talk-row active" : "talk-row"} data-testid="talk-row" style={{ "--spk": speakerColor(i) } as CSSProperties}>
            {editing === x.label ? (
              <form
                className="talk-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  // A refused rename keeps the form and what was typed.
                  void onRename(x.label, draft.trim()).then((ok) => ok !== false && setEditing(null));
                }}
              >
                <input
                  aria-label={`Name for ${x.label}`}
                  autoFocus
                  maxLength={100}
                  value={draft}
                  placeholder={x.label}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                />
                <button type="submit" className="btn small primary">
                  Save
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={i === at}
                  className="talk-tab"
                  onClick={() => setPicked(i)}
                  onKeyDown={(e) => {
                    const n = stats.speakers.length;
                    if (e.key === "ArrowRight") setPicked((at + 1) % n);
                    if (e.key === "ArrowLeft") setPicked((at - 1 + n) % n);
                  }}
                >
                  <span className="spk-dot" aria-hidden="true" />
                  <span className="talk-name">{nameOf(x.label)}</span>
                  {nameOf(x.label) !== x.label && <span className="dim talk-label">{x.label}</span>}
                  <span className="talk-share">{formatShare(x.share)}</span>
                </button>
                {canRename && (
                  <button
                    type="button"
                    className="icon-btn talk-pen"
                    aria-label={`Rename ${nameOf(x.label)}`}
                    title="Name this speaker"
                    onClick={() => {
                      setPicked(i);
                      setDraft(nameOf(x.label) === x.label ? "" : nameOf(x.label));
                      setEditing(x.label);
                    }}
                  >
                    <Icon name="pen" size={12} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="talk-panel" role="tabpanel" aria-label={`${nameOf(s.label)}'s numbers`} key={s.label} style={{ "--spk": speakerColor(at) } as CSSProperties}>
        <dl className="talk-tiles">
          {tiles.map(([k, v], i) => (
            <div key={k} style={{ "--k": i } as CSSProperties}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {onSeek && (
          <button type="button" className="talk-first" onClick={() => onSeek(s.firstMs)}>
            <Icon name="play" size={10} /> First spoke at <span className="mono">{formatClock(s.firstMs)}</span>
          </button>
        )}
      </div>
    </section>
  );
}
