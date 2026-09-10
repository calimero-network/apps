/**
 * Mero Sheets hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

const COLS = 4;
const ROWS = 5;
const W = 44;
const H = 22;

/** Cells fill in as two people type, each with their own cursor. */
export default function SheetsAnimation() {
  const filled: [number, number, string][] = [
    [0, 0, '0.3s'], [1, 0, '0.6s'], [2, 0, '0.9s'],
    [0, 1, '1.2s'], [1, 1, '1.5s'],
    [3, 2, '1.9s'], [3, 3, '2.3s'],
  ];
  const cells = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      cells.push(<span key={`${r}-${c}`} className="cal-lp-a-box" style={{ left: 18 + c * W, top: 34 + r * H, width: W - 2, height: H - 2, borderRadius: 2 }} />);
    }
  }
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {cells}
      {filled.map(([c, r, d], i) => (
        <span key={i} className="cal-lp-a-box cal-lp-a-fill" style={{ left: 18 + c * W, top: 34 + r * H, width: W - 2, height: H - 2, borderRadius: 2, ['--d' as string]: d, ['--t' as string]: '5.5s' }} />
      ))}
      {filled.map(([c, r, d], i) => (
        <span key={`v${i}`} className="cal-lp-a-line cal-lp-a-rise" style={{ left: 24 + c * W, top: 43 + r * H, width: 24, height: 5, ['--d' as string]: d, ['--t' as string]: '5.5s' }} />
      ))}
      <span className="cal-lp-a-chip" style={{ right: 16, top: 10 }}>SUM()</span>
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 62, top: 46, ['--dx' as string]: '92px', ['--dy' as string]: '48px', ['--t' as string]: '5.5s' }} />
    </div>
  );
}
