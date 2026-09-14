/**
 * Battleships — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ Sized to the frame. Two 5x5 boards of 15px cells filled 43% of the width
 * and left the right-hand half of the frame empty — a measured figure, not an
 * impression. Eight-by-eight at 22px is a real Battleships grid and uses the
 * space the frame actually has.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx, which scales the whole box to whatever the frame is.
 */

const CELL = 22;
const GAP = 4;
const N = 8;
const COORD = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const GRID_TOP = 52;
/** Width of one whole board, so the second can be placed off the first. */
const BOARD_W = N * (CELL + GAP) - GAP;

type Shot = [number, number, boolean, string];

function Board({
  x,
  label,
  shots,
  ships = [],
}: {
  x: number;
  label: string;
  shots: Shot[];
  /** [row, col, length] — drawn only on the board its owner can see. */
  ships?: [number, number, number][];
}) {
  const cells = [];
  for (let r = 0; r < N; r += 1) {
    for (let c = 0; c < N; c += 1) {
      cells.push(
        <span
          key={`${r}-${c}`}
          className="cal-lp-a-box"
          style={{ left: x + c * (CELL + GAP), top: GRID_TOP + r * (CELL + GAP), width: CELL, height: CELL, borderRadius: 3 }}
        />,
      );
    }
  }
  return (
    <>
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: x, top: 14 }}>{label}</span>
      {COORD.map((l, i) => (
        <span
          key={l}
          className="cal-lp-a-txt cal-lp-a-txt--dim"
          style={{ left: x + i * (CELL + GAP), top: 36, width: CELL, textAlign: 'center', fontSize: 8.5 }}
        >
          {l}
        </span>
      ))}
      {Array.from({ length: N }, (_, i) => (
        <span
          key={`rn${label}${i}`}
          className="cal-lp-a-txt cal-lp-a-txt--dim"
          style={{ left: x - 14, top: GRID_TOP + i * (CELL + GAP) + 7, width: 10, textAlign: 'right', fontSize: 8.5 }}
        >
          {i + 1}
        </span>
      ))}
      {cells}
      {ships.map(([r, c, len], i) => (
        <span
          key={`ship${i}`}
          className="cal-lp-a-pane"
          style={{
            left: x + c * (CELL + GAP),
            top: GRID_TOP + r * (CELL + GAP),
            width: len * (CELL + GAP) - GAP,
            height: CELL,
            borderRadius: 3,
            background: 'var(--cal-lp-border-strong)',
            borderColor: 'transparent',
            opacity: 0.55,
          }}
        />
      ))}
      {shots.map(([r, c, hit, d], i) => (
        <span
          key={`s${i}`}
          className={hit ? 'cal-lp-a-box cal-lp-a-fill' : 'cal-lp-a-box cal-lp-a-flash'}
          style={{
            left: x + c * (CELL + GAP),
            top: GRID_TOP + r * (CELL + GAP),
            width: CELL,
            height: CELL,
            borderRadius: 3,
            ...(hit ? {} : { background: 'transparent' }),
            ['--d' as string]: d,
            ['--t' as string]: '6s',
          }}
        />
      ))}
    </>
  );
}

const LEFT_X = 34;
const RIGHT_X = LEFT_X + BOARD_W + 46;

/** Two boards trading shots; hits fill, misses just flash. */
export default function BattleshipsAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <Board
        x={LEFT_X}
        label="Your fleet"
        ships={[
          [1, 1, 3],
          [4, 0, 2],
          [6, 4, 4],
        ]}
        shots={[
          [1, 1, true, '0.8s'],
          [3, 5, false, '2.2s'],
          [6, 6, true, '4.4s'],
        ]}
      />
      <Board
        x={RIGHT_X}
        label="Theirs"
        shots={[
          [0, 3, true, '1.5s'],
          [2, 0, false, '2.9s'],
          [4, 4, true, '3.6s'],
          [5, 7, false, '5.0s'],
        ]}
      />

      {/* The status line, and the claim the whole app exists to make. */}
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ left: LEFT_X, top: 284 }}>D1 — hit</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: RIGHT_X, top: 284, fontSize: 9 }}>
        Their turn
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: LEFT_X, bottom: 6, fontSize: 8.5 }}>
        Your board is node-local — theirs is never sent to you either
      </span>
    </div>
  );
}
