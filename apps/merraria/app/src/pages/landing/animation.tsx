/**
 * Merraria — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ A whole world, not a strip. Ten columns by four rows occupied the top-left
 * corner and left most of the frame blank — which for a game about a world you
 * dig into is the wrong picture entirely. A grid that reaches the edges fills it, and the
 * layers (grass, dirt, stone, ore) make it read as terrain rather than as a
 * grid of boxes. Twenty-six by fourteen reaches the bottom of the frame.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const T = 17;
const COLS = 26;
const ROWS = 14;
const LEFT = 22;
const TOP = 58;

/** Terrain is a pure function of the row — the same idea as the real seed. */
function tileColour(row: number, col: number): string {
  if (row === 0) return 'var(--cal-lp-accent-soft)'; // grass
  if (row <= 2) return 'var(--cal-lp-bg-3)'; // dirt
  // A scattering of ore in the stone, deterministic so it never flickers.
  if (row >= 4 && (col * 7 + row * 13) % 19 === 0) return 'var(--cal-lp-accent)';
  return 'var(--cal-lp-border)';
}

/** A side-on world being mined; two shafts go down while another player digs. */
export default function MerrariaAnimation() {
  // Two shafts, dug tile by tile — the left one deeper than the right.
  const mined: Record<string, string> = {};
  [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((r) => {
    mined[`5-${r}`] = `${0.3 + r * 0.22}s`;
  });
  [0, 1, 2, 3, 4, 5].forEach((r) => {
    mined[`18-${r}`] = `${1.0 + r * 0.26}s`;
  });
  // A horizontal drift off the left shaft, the way a real mine opens out.
  [6, 7, 8].forEach((c, i) => {
    mined[`${c}-8`] = `${2.3 + i * 0.2}s`;
  });

  const tiles = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const key = `${c}-${r}`;
      const d = mined[key];
      tiles.push(
        <span
          key={key}
          className={d ? 'cal-lp-a-box cal-lp-a-blink' : 'cal-lp-a-box'}
          style={{
            left: LEFT + c * T,
            top: TOP + r * T,
            width: T - 2,
            height: T - 2,
            borderRadius: 2,
            background: d ? 'transparent' : tileColour(r, c),
            borderColor: d ? 'var(--cal-lp-border)' : 'transparent',
            ...(d ? { ['--d' as string]: d, ['--t' as string]: '6s' } : {}),
          }}
        />,
      );
    }
  }

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>World · seed 1907</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>Offline ok · 2 players</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: LEFT, top: 40, fontSize: 8.5 }}>surface</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 20, top: 40, fontSize: 8.5 }}>
        18 tile edits this session
      </span>
      {tiles}

      {/* Two players, each descending their own shaft. */}
      <span
        className="cal-lp-a-av cal-lp-a-drift"
        style={{ left: LEFT + 5 * T - 2, top: TOP - 20, ['--dx' as string]: '0px', ['--dy' as string]: `${8 * T}px`, ['--t' as string]: '6s' }}
      >
        Y
      </span>
      <span
        className="cal-lp-a-av cal-lp-a-drift"
        style={{
          left: LEFT + 18 * T - 2,
          top: TOP - 20,
          background: 'var(--cal-lp-border-strong)',
          color: 'var(--cal-lp-text)',
          ['--dx' as string]: '0px',
          ['--dy' as string]: `${5 * T}px`,
          ['--t' as string]: '6s',
        }}
      >
        M
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 4, fontSize: 8.5 }}>
        Seed + tile edits, no game server — same world on every machine
      </span>
    </div>
  );
}
