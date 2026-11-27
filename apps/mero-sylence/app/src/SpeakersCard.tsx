import { useState } from "react";
import { formatShare, type TalkStats } from "./lib/stats";
import { speakerColor } from "./lib/playback";
import { formatClock, formatDuration } from "./lib/transcript";
import { Icon } from "./ui";
import "./playback.css";

/**
 * Who talked and how much: a share bar, then one row per speaker with talk
 * time, words, turns, longest turn, pace and questions. A speaker can be
 * given a name (`Speaker 1` → `Eve`) by whoever may edit the meeting.
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
  if (stats.speakers.length === 0) return null;
  return (
    <section className="card talk-card" aria-labelledby="talk-title">
      <div className="card-head">
        <h2 id="talk-title">Talk time</h2>
        <span className="dim">{formatDuration(stats.totalTalkMs)} of speech</span>
      </div>
      <div className="talk-bar" role="img" aria-label={stats.speakers.map((s) => `${nameOf(s.label)} ${formatShare(s.share)}`).join(", ")}>
        {stats.speakers.map((s, i) => (
          <span key={s.label} style={{ width: `${s.share * 100}%`, background: speakerColor(i) }} title={`${nameOf(s.label)}: ${formatShare(s.share)}`} />
        ))}
      </div>
      <ol className="talk-list">
        {stats.speakers.map((s, i) => (
          <li key={s.label} className="talk-row" data-testid="talk-row">
            <div className="talk-who">
              <span className="spk-dot" style={{ background: speakerColor(i) }} aria-hidden="true" />
              {editing === s.label ? (
                <form
                  className="talk-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onRename(s.label, draft.trim()).then(() => setEditing(null));
                  }}
                >
                  <input
                    aria-label={`Name for ${s.label}`}
                    autoFocus
                    maxLength={100}
                    value={draft}
                    placeholder={s.label}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                  />
                  <button type="submit" className="btn small primary">
                    Save
                  </button>
                </form>
              ) : (
                <>
                  <span className="talk-name">{nameOf(s.label)}</span>
                  {nameOf(s.label) !== s.label && <span className="dim talk-label">{s.label}</span>}
                  {canRename && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Rename ${nameOf(s.label)}`}
                      title="Name this speaker"
                      onClick={() => {
                        setDraft(nameOf(s.label) === s.label ? "" : nameOf(s.label));
                        setEditing(s.label);
                      }}
                    >
                      <Icon name="pen" size={12} />
                    </button>
                  )}
                </>
              )}
              <span className="talk-share">{formatShare(s.share)}</span>
            </div>
            <dl className="talk-stats">
              <div>
                <dt>Talked</dt>
                <dd>{formatDuration(s.talkMs)}</dd>
              </div>
              <div>
                <dt>Words</dt>
                <dd>{s.words.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Turns</dt>
                <dd>{s.turns.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Longest</dt>
                <dd>{formatDuration(s.longestTurnMs)}</dd>
              </div>
              <div>
                <dt>Pace</dt>
                <dd>{s.wpm ? `${s.wpm} wpm` : "—"}</dd>
              </div>
              <div>
                <dt>Questions</dt>
                <dd>{s.questions.toLocaleString()}</dd>
              </div>
            </dl>
            {onSeek && (
              <button type="button" className="talk-first" onClick={() => onSeek(s.firstMs)}>
                First spoke at <span className="mono">{formatClock(s.firstMs)}</span>
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
