/**
 * Battleships — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

const CELL = 15;
const GAP = 3;
const COORD = ['A', 'B', 'C', 'D', 'E'];

function Board({ x, label, shots }: { x: number; label: string; shots: [number, number, boolean, string][] }) {
  const cells = [];
  for (let r = 0; r < 5; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      cells.push(<span key={`${r}-${c}`} className="cal-lp-a-box" style={{ left: x + c * (CELL + GAP), top: 48 + r * (CELL + GAP), width: CELL, height: CELL, borderRadius: 2 }} />);
    }
  }
  return (
    <>
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: x, top: 12 }}>{label}</span>
      {COORD.map((l, i) => (
        <span key={l} className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: x + i * (CELL + GAP) + 4, top: 32, fontSize: 8 }}>{l}</span>
      ))}
      {cells}
      {shots.map(([r, c, hit, d], i) => (
        <span
          key={`s${i}`}
          className={hit ? 'cal-lp-a-box cal-lp-a-fill' : 'cal-lp-a-box cal-lp-a-flash'}
          style={{
            left: x + c * (CELL + GAP), top: 48 + r * (CELL + GAP), width: CELL, height: CELL, borderRadius: 2,
            ...(hit ? {} : { background: 'transparent' }),
            ['--d' as string]: d, ['--t' as string]: '6s',
          }}
        />
      ))}
    </>
  );
}

/** Two boards trading shots; hits fill, misses just flash. */
export default function BattleshipsAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <Board x={20} label="Your fleet" shots={[[1, 1, false, '0.8s'], [3, 2, true, '2.2s']]} />
      <Board x={128} label="Theirs" shots={[[0, 3, true, '1.5s'], [2, 0, false, '2.9s'], [4, 4, true, '3.6s']]} />
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ left: 20, top: 148 }}>C4 — hit</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>Your board never leaves your node</span>
    </div>
  );
}
