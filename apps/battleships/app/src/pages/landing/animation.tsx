/**
 * Battleships hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

const CELL = 15;
const GAP = 3;

/** Your board left, theirs right. Shots land alternately; a hit flashes. */
function Board({ x, hits, label }: { x: number; hits: [number, number][]; label: string }) {
  const cells = [];
  for (let r = 0; r < 5; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      const shot = hits.findIndex(([hr, hc]) => hr === r && hc === c);
      cells.push(
        <span
          key={`${r}-${c}`}
          className={shot >= 0 ? 'cal-lp-a-box cal-lp-a-fill' : 'cal-lp-a-box'}
          style={{
            left: x + c * (CELL + GAP),
            top: 40 + r * (CELL + GAP),
            width: CELL,
            height: CELL,
            ...(shot >= 0 ? { ['--d' as string]: `${0.5 + shot * 0.7}s`, ['--t' as string]: '5s' } : {}),
          }}
        />,
      );
    }
  }
  return (
    <>
      <span className="cal-lp-a-chip" style={{ left: x, top: 14 }}>{label}</span>
      {cells}
    </>
  );
}

export default function BattleshipsAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <Board x={22} label="Your fleet" hits={[[1, 1], [3, 2]]} />
      <Board x={132} label="Theirs" hits={[[0, 3], [2, 0], [4, 4]]} />
      <span className="cal-lp-a-line cal-lp-a-grow" style={{ left: 22, top: 152, width: 200, ['--d' as string]: '1.6s', ['--t' as string]: '5s', transformOrigin: 'left' }} />
    </div>
  );
}
