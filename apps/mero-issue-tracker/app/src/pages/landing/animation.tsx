/**
 * Mero Issue Tracker hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

const COLS = ['Todo', 'In progress', 'Done'];

/** Three columns; a card walks Todo to Done while a second cursor drags one back. */
export default function IssueTrackerAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {COLS.map((c, i) => (
        <span key={c} className="cal-lp-a-pane" style={{ left: 18 + i * 74, top: 36, width: 66, bottom: 20 }} />
      ))}
      {COLS.map((c, i) => (
        <span key={`h${c}`} className="cal-lp-a-chip" style={{ left: 18 + i * 74, top: 14 }}>{c}</span>
      ))}
      {/* static cards */}
      <span className="cal-lp-a-box" style={{ left: 24, top: 44, width: 54, height: 26 }} />
      <span className="cal-lp-a-box" style={{ left: 24, top: 76, width: 54, height: 26 }} />
      <span className="cal-lp-a-box" style={{ left: 172, top: 44, width: 54, height: 26 }} />
      {/* the travelling card */}
      <span
        className="cal-lp-a-box cal-lp-a-drift"
        style={{
          left: 24, top: 108, width: 54, height: 26,
          background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent',
          ['--dx' as string]: '74px', ['--dy' as string]: '-32px', ['--t' as string]: '5s',
        }}
      />
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 84, top: 118, ['--dx' as string]: '74px', ['--dy' as string]: '-28px', ['--t' as string]: '5s' }} />
    </div>
  );
}
