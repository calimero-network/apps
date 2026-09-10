/**
 * Mero Sheets — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows REAL labels, the way the bespoke previews this replaced did. An
 * abstract rectangle says nothing about what the app is for; "=SUM(A1:A3)" or
 * "Todo / In progress / Done" says it immediately.
 */

const COLS = ['A', 'B', 'C'];
const CW = 52;
const RH = 20;

/** A mini spreadsheet: values and a formula land cell by cell under two cursors. */
export default function SheetsAnimation() {
  const cells: [number, number, string, string | null][] = [
    [0, 0, '1 200', '0.4s'],
    [1, 0, 'Wages', '0.9s'],
    [0, 1, '3 400', '1.4s'],
    [1, 1, 'Rent', '1.9s'],
    [0, 2, '2 100', '2.4s'],
    [1, 2, 'Misc', '2.9s'],
  ];
  const grid = [];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < COLS.length; c += 1) {
      grid.push(<span key={`g${r}-${c}`} className="cal-lp-a-box" style={{ left: 40 + c * CW, top: 46 + r * RH, width: CW - 1, height: RH - 1, borderRadius: 2 }} />);
    }
  }
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-av" style={{ left: 20, top: 8 }}>A</span>
      <span className="cal-lp-a-av" style={{ left: 40, top: 8, background: 'var(--cal-lp-border-strong)', color: 'var(--cal-lp-text)' }}>M</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 64, top: 13 }}>2 collaborators</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 13 }}>live</span>

      {COLS.map((l, i) => (
        <span key={l} className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 40 + i * CW + 22, top: 36 }}>{l}</span>
      ))}
      {[1, 2, 3, 4].map((n, i) => (
        <span key={n} className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 26, top: 52 + i * RH }}>{n}</span>
      ))}
      {grid}

      {cells.map(([c, r, v, d], i) => (
        <span key={`f${i}`} className="cal-lp-a-box cal-lp-a-fill" style={{ left: 40 + c * CW, top: 46 + r * RH, width: CW - 1, height: RH - 1, borderRadius: 2, ['--d' as string]: d!, ['--t' as string]: '6s' }} />
      ))}
      {cells.map(([c, r, v, d], i) => (
        <span key={`v${i}`} className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 46 + c * CW, top: 52 + r * RH, ['--d' as string]: d!, ['--t' as string]: '6s' }}>{v}</span>
      ))}

      {/* the formula, last */}
      <span className="cal-lp-a-box cal-lp-a-fill" style={{ left: 40, top: 46 + 3 * RH, width: CW * 2 - 1, height: RH - 1, borderRadius: 2, ['--d' as string]: '3.5s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-rise" style={{ left: 46, top: 52 + 3 * RH, ['--d' as string]: '3.5s', ['--t' as string]: '6s' }}>=SUM(A1:A3) → 6 700</span>

      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 96, top: 62, ['--dx' as string]: '54px', ['--dy' as string]: '42px', ['--t' as string]: '6s' }} />
    </div>
  );
}
