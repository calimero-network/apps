import { useMemo, useState, type CSSProperties } from "react";
import type { ActionView, Insights, PersonInsight } from "./generated/client";
import type { Analyze } from "./useAnalyze";
import { formatShare, type SpeakerStats, type TalkStats } from "./lib/stats";
import { assignedTo, TONE_GROUPS, type Tone } from "./lib/insights";
import { EMOTION_MODEL } from "./ai/insightsProtocol";
import { formatClock, formatWhen } from "./lib/transcript";
import { speakerColor } from "./lib/playback";
import { Icon } from "./ui";
import "./people.css";

const TONE_NAMES: Record<Tone, string> = {
  enthusiastic: "Enthusiastic",
  positive: "Positive",
  neutral: "Neutral",
  curious: "Curious",
  concerned: "Concerned",
  frustrated: "Frustrated",
};

const asTone = (t: string): Tone => (t in TONE_NAMES ? (t as Tone) : "neutral");

const PHASE_TEXT: Record<Analyze["phase"], string> = {
  idle: "",
  model: "Downloading the emotion model",
  classifying: "Reading the tone of every line",
  writing: "Writing profiles",
  saving: "Saving",
  done: "Done",
  error: "",
};

/**
 * Who was in the meeting and how they came across: per person, the tone, the
 * strongest emotions, a profile, their key points and their action items.
 * Without saved insights it offers to work them out on this laptop.
 */
export function PeopleCard({
  insights,
  stats,
  actions,
  displayName,
  canAnalyze,
  analyze,
  onSeek,
}: {
  insights: Insights | null;
  stats: TalkStats;
  actions: ActionView[] | null;
  displayName: (label: string) => string;
  canAnalyze: boolean;
  analyze: Analyze;
  onSeek?: (ms: number) => void;
}) {
  const byLabel = useMemo(() => new Map((insights?.people ?? []).map((p) => [p.label, p])), [insights]);
  // People the stats know, then any the insights name that no longer speak.
  const people = useMemo(() => {
    const rows: { label: string; stats: SpeakerStats | null; insight: PersonInsight | null }[] = stats.speakers.map((s) => ({
      label: s.label,
      stats: s,
      insight: byLabel.get(s.label) ?? null,
    }));
    for (const p of insights?.people ?? []) if (!stats.speakers.some((s) => s.label === p.label)) rows.push({ label: p.label, stats: null, insight: p });
    return rows;
  }, [stats, insights, byLabel]);

  const busy = analyze.phase !== "idle" && analyze.phase !== "done" && analyze.phase !== "error";

  if (!people.length && !canAnalyze) return null;

  return (
    <section className="card people-card" aria-labelledby="people-title">
      <div className="card-head">
        <h2 id="people-title">People</h2>
        {insights && (
          <span className="dim people-updated">
            Updated {formatWhen(insights.updatedAt)}
            {insights.model ? ` · ${insights.model}` : ""}
          </span>
        )}
      </div>

      {!insights && !busy && (
        <p className="empty people-intro">
          See each person&rsquo;s tone, a short profile and the points they made.
          {canAnalyze
            ? ` It runs on this laptop: an emotion model of about ${EMOTION_MODEL.sizeMb} MB is downloaded once, and the transcript stays here.`
            : " The meeting's recorder can analyze it."}
        </p>
      )}

      {canAnalyze && <AnalyzeControls analyze={analyze} again={!!insights} busy={busy} />}

      {people.length > 0 && <PeopleTabs people={people} stats={stats} actions={actions} displayName={displayName} onSeek={onSeek} />}
    </section>
  );
}

type Row = { label: string; stats: SpeakerStats | null; insight: PersonInsight | null };

/**
 * One person at a time: a tab per person (their colour and name), back and
 * next, and the chosen person's panel sliding in from the side it came from.
 * Every panel stays in the page (the others `hidden`), so search and tests
 * find each person's words.
 */
function PeopleTabs({
  people,
  stats,
  actions,
  displayName,
  onSeek,
}: {
  people: Row[];
  stats: TalkStats;
  actions: ActionView[] | null;
  displayName: (label: string) => string;
  onSeek?: (ms: number) => void;
}) {
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const current = Math.min(at, people.length - 1);
  const go = (i: number) => {
    const next = (i + people.length) % people.length;
    setDir(next >= current ? 1 : -1);
    setAt(next);
  };
  const colorOf = (label: string) => {
    const i = stats.speakers.findIndex((s) => s.label === label);
    return speakerColor(i < 0 ? 7 : i);
  };
  return (
    <div className="people-tabs">
      <div className="ptabs-bar">
        <div className="ptabs" role="tablist" aria-label="People">
          {people.map((p, i) => (
            <button
              key={p.label}
              type="button"
              role="tab"
              id={`ptab-${i}`}
              aria-selected={i === current}
              aria-controls={`ppanel-${i}`}
              tabIndex={i === current ? 0 : -1}
              className={i === current ? "ptab active" : "ptab"}
              style={{ "--spk": colorOf(p.label) } as CSSProperties}
              onClick={() => go(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") go(current + 1);
                if (e.key === "ArrowLeft") go(current - 1);
              }}
            >
              <span className="ptab-dot" aria-hidden="true" />
              <span className="ptab-name">{displayName(p.label)}</span>
              {p.stats && <span className="ptab-share">{formatShare(p.stats.share)}</span>}
            </button>
          ))}
        </div>
        {people.length > 1 && (
          <div className="ptabs-nav">
            <button type="button" className="icon-btn" aria-label="Previous person" onClick={() => go(current - 1)}>
              <Icon name="left" size={14} />
            </button>
            <span className="ptabs-count" aria-hidden="true">
              {current + 1}/{people.length}
            </span>
            <button type="button" className="icon-btn" aria-label="Next person" onClick={() => go(current + 1)}>
              <Icon name="right" size={14} />
            </button>
          </div>
        )}
      </div>
      <ul className="people-list">
        {people.map((p, i) => (
          <Person
            key={p.label}
            index={i}
            active={i === current}
            dir={dir}
            color={colorOf(p.label)}
            name={displayName(p.label)}
            label={p.label}
            stats={p.stats}
            insight={p.insight}
            actions={(actions ?? []).filter((a) => assignedTo(a.assignee, displayName(p.label), p.label))}
            onSeek={onSeek}
          />
        ))}
      </ul>
    </div>
  );
}

function AnalyzeControls({ analyze, again, busy }: { analyze: Analyze; again: boolean; busy: boolean }) {
  const [useLlm, setUseLlm] = useState(false);
  if (busy) {
    const pct = Math.round(analyze.fraction * 100);
    return (
      <div className="analyze-progress" role="status" aria-live="polite">
        <div className="analyze-progress-row">
          <span>
            {PHASE_TEXT[analyze.phase]}
            {analyze.phase !== "saving" ? ` · ${pct}%` : "…"}
          </span>
          <button type="button" className="btn small ghost" onClick={analyze.cancel}>
            Cancel
          </button>
        </div>
        <div
          className="analyze-bar"
          role="progressbar"
          aria-label={PHASE_TEXT[analyze.phase]}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="analyze-controls">
      <button type="button" className={`btn small${again ? " ghost" : " primary"}`} onClick={() => void analyze.run({ useLlm })}>
        <Icon name="wave" size={14} /> {again ? "Re-analyze" : "Analyze"}
      </button>
      {analyze.canWrite && (
        <label className="analyze-llm">
          <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
          Write profiles with Smart notes model
        </label>
      )}
      {analyze.phase === "done" && !analyze.message && <span className="dim">Saved for everyone in the workspace.</span>}
      {analyze.message && (
        <span className={analyze.phase === "error" ? "err" : "dim"} role={analyze.phase === "error" ? "alert" : undefined}>
          {analyze.message}
        </span>
      )}
    </div>
  );
}

function Person({
  index,
  active,
  dir,
  color,
  name,
  label,
  stats,
  insight,
  actions,
  onSeek,
}: {
  index: number;
  active: boolean;
  dir: 1 | -1;
  color: string;
  name: string;
  label: string;
  stats: SpeakerStats | null;
  insight: PersonInsight | null;
  actions: ActionView[];
  onSeek?: (ms: number) => void;
}) {
  const tone = insight ? asTone(insight.tone) : null;
  const emotions = (insight?.emotions ?? []).filter((e) => e.label !== "neutral").slice(0, 3);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <li
      className={`person ${dir === 1 ? "from-right" : "from-left"}`}
      data-testid="person"
      role="tabpanel"
      id={`ppanel-${index}`}
      aria-labelledby={`ptab-${index}`}
      hidden={!active}
      style={{ "--spk": color } as CSSProperties}
    >
      <div className="person-head">
        <span className="person-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="person-name">
          <strong>{name}</strong>
          {name !== label && <span className="dim person-label">{label}</span>}
        </span>
        {tone && (
          <span className={`tone-badge tone-${tone}`} title="Tone">
            <span className="tone-dot" aria-hidden="true" />
            {TONE_NAMES[tone]}
          </span>
        )}
        {stats && (
          <span className="person-share dim" title="Share of talk time">
            {formatShare(stats.share)}
          </span>
        )}
      </div>

      {insight?.profile && <p className="person-profile">{insight.profile}</p>}

      {emotions.length > 0 && (
        <ul className="emotion-bars" aria-label={`${name}'s strongest emotions`}>
          {emotions.map((e, k) => (
            <li key={e.label} style={{ "--k": k } as CSSProperties}>
              <span className="emotion-label">{e.label}</span>
              <span className="emotion-track" aria-hidden="true">
                <span className={`emotion-fill tone-${(Object.hasOwn(TONE_GROUPS, e.label) && TONE_GROUPS[e.label]) || "neutral"}`} style={{ width: `${Math.max(4, e.share / 10)}%` }} />
              </span>
              <span className="emotion-value dim">{Math.round(e.share / 10)}%</span>
            </li>
          ))}
        </ul>
      )}

      <div className="person-grid">
      {insight && insight.keyPoints.length > 0 && (
        <div className="person-section">
          <h3>Key points</h3>
          <ul className="key-points">
            {insight.keyPoints.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      )}

      {actions.length > 0 && (
        <div className="person-section">
          <h3>Action items</h3>
          <ul className="person-actions">
            {actions.map((a) => (
              <li key={a.id} className={a.done ? "done" : undefined}>
                <Icon name={a.done ? "check" : "list"} size={14} />
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>

      {stats && onSeek && (
        <button type="button" className="btn small ghost person-jump" onClick={() => onSeek(stats.firstMs)}>
          <Icon name="right" size={14} /> First spoke at {formatClock(stats.firstMs)}
        </button>
      )}
    </li>
  );
}
