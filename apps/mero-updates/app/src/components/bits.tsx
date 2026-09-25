// Small presentational pieces shared by several pages.

import { useState } from "react";

import type { CategoryView, ReactionCount } from "../generated/UpdatesClient";
import { initials } from "../lib/people";
import { REACTIONS, parseMetric, personLabel } from "../lib/updates";

export function CategoryChip({
  category,
  onClick,
  active,
  count,
}: {
  category: Pick<CategoryView, "name" | "emoji" | "color">;
  onClick?: () => void;
  active?: boolean;
  count?: number;
}) {
  const style = { "--chip": category.color || "var(--text-faint)" } as React.CSSProperties;
  const body = (
    <>
      {category.emoji && <span aria-hidden>{category.emoji}</span>}
      {category.name}
      {count !== undefined && count > 0 && <span className="chipCount">{count}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="chip" data-active={active} style={style} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className="chip" style={style}>
      {body}
    </span>
  );
}

export function Avatar({ name, account, team }: { name: string; account: string; team?: boolean }) {
  return (
    <span className="avatar" data-team={team} aria-hidden>
      {initials(personLabel(name, account))}
    </span>
  );
}

/**
 * One-tap reactions. The lowest-effort way to answer an update — and for a
 * founder, "12 people 🎉'd this" is a signal an open rate never was.
 */
export function Reactions({
  reactions,
  onToggle,
}: {
  reactions: ReactionCount[];
  onToggle: (emoji: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const used = reactions.filter((r) => r.count > 0);
  return (
    <div className="reactions">
      {used.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className="reaction"
          aria-pressed={r.mine}
          onClick={() => onToggle(r.emoji, !r.mine)}
          title={r.mine ? "Remove your reaction" : "React"}
        >
          <span>{r.emoji}</span>
          <span className="reactionCount">{r.count}</span>
        </button>
      ))}
      <div className="reactPicker">
        <button
          type="button"
          className="reaction add"
          aria-expanded={open}
          aria-label="Add a reaction"
          onClick={() => setOpen((v) => !v)}
          data-testid="react-open"
        >
          ☺︎+
        </button>
        {open && (
          <div className="reactMenu" role="menu">
            {REACTIONS.map((e) => {
              const mine = reactions.find((r) => r.emoji === e)?.mine ?? false;
              return (
                <button
                  key={e}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={mine}
                  onClick={() => {
                    setOpen(false);
                    onToggle(e, !mine);
                  }}
                >
                  {e}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A KPI trend with no chart library: the points that parse as numbers, drawn
 * as a polyline. Text values ("n/a") are skipped rather than charted as zero.
 */
export function Sparkline({ values, width = 120, height = 32 }: { values: string[]; width?: number; height?: number }) {
  const nums = values.map(parseMetric).filter((n): n is number => n !== null);
  if (nums.length < 2) return <span className="sparkEmpty">—</span>;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pad = 3;
  const pts = nums
    .map((n, i) => {
      const x = pad + (i / (nums.length - 1)) * (width - pad * 2);
      const y = height - pad - ((n - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="currentColor" />
    </svg>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="emptyState">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}
