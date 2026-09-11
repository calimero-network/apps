/**
 * Mero Blocks — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ A world, not a staircase. Ten blocks in the top-left corner is not what a
 * voxel sandbox looks like; a terraced build across the frame is. The isometric
 * offset (`r * 9` on x, `r * S` on y) is what makes a flat grid read as depth
 * without drawing anything three-dimensional.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const S = 26;
const BASE_X = 34;
const BASE_Y = 246;

/** Per tier: how many columns wide, and where it starts. */
const TIERS: [number, number][] = [
  [14, 0],
  [11, 1],
  [8, 2],
  [5, 3],
  [2, 4],
];

/** Blocks that animate in, keyed "tier-col". */
const PLACED: Record<string, string> = {
  '2-6': '0.9s',
  '3-3': '1.6s',
  '3-4': '2.3s',
  '4-1': '3.0s',
};

export default function BlocksAnimation() {
  const blocks: React.ReactNode[] = [];
  TIERS.forEach(([width, start], tier) => {
    for (let c = 0; c < width; c += 1) {
      const key = `${tier}-${c}`;
      const d = PLACED[key];
      blocks.push(
        <span
          key={key}
          className={d ? 'cal-lp-a-box cal-lp-a-in' : 'cal-lp-a-box'}
          style={{
            left: BASE_X + (start + c) * S + tier * 9,
            top: BASE_Y - tier * S,
            width: S - 3,
            height: S - 3,
            borderRadius: 3,
            background: tier === 0 ? 'var(--cal-lp-bg-3)' : tier >= 3 ? 'var(--cal-lp-accent-soft)' : 'var(--cal-lp-border)',
            borderColor: 'transparent',
            ...(d ? { ['--d' as string]: d, ['--t' as string]: '6s' } : {}),
          }}
        />,
      );
    }
  });

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>World · seed 4821</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>2 players · 41 edits</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, top: 30, fontSize: 8.5 }}>
        Terrain from the seed — only the blocks you changed are stored
      </span>

      {blocks}

      {/* The other player, up on the build. */}
      <span className="cal-lp-a-av" style={{ left: 300, top: 128 }}>M</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 296, top: 150, fontSize: 8.5 }}>Marko</span>
      <span
        className="cal-lp-a-cursor cal-lp-a-drift"
        style={{ left: 250, top: 170, ['--dx' as string]: '-64px', ['--dy' as string]: '40px', ['--t' as string]: '6s' }}
      />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 3, fontSize: 8.5 }}>
        Seed + edits, no game server — the world is a context you own
      </span>
    </div>
  );
}
