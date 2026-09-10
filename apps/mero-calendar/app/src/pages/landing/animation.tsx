/**
 * Mero Calendar hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

const COLS = 5;
const W = 34;
const GAP = 6;

/** A week grid. Events drop in, and a second person adds an overlapping one. */
export default function CalendarAnimation() {
  const events: [number, number, number, string][] = [
    [0, 34, 26, '0.4s'],
    [2, 58, 34, '0.9s'],
    [1, 96, 22, '1.4s'],
    [3, 46, 44, '1.9s'],
    [4, 74, 28, '2.4s'],
  ];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {Array.from({ length: COLS }, (_, i) => (
        <span key={i} className="cal-lp-a-pane" style={{ left: 20 + i * (W + GAP), top: 34, width: W, bottom: 22 }} />
      ))}
      {Array.from({ length: COLS }, (_, i) => (
        <span key={`h${i}`} className="cal-lp-a-line" style={{ left: 20 + i * (W + GAP) + 8, top: 20, width: 18, height: 5 }} />
      ))}
      {events.map(([col, top, h, d], i) => (
        <span
          key={i}
          className="cal-lp-a-box cal-lp-a-rise"
          style={{
            left: 20 + col * (W + GAP) + 3, top, width: W - 6, height: h,
            background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent',
            ['--d' as string]: d, ['--t' as string]: '5s',
          }}
        />
      ))}
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 120, top: 96, ['--dx' as string]: '-46px', ['--dy' as string]: '34px', ['--t' as string]: '5s' }} />
    </div>
  );
}
