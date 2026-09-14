/**
 * Mero Blocks — the hero animation: an isometric voxel island being edited.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * ⚠️ WHAT WAS WRONG BEFORE
 * The previous version drew a terrace of rounded grey squares. Flat, no cube
 * faces, no block colours — it read as a bar chart, and nothing in it said
 * "voxel sandbox". Mero Blocks is a Minecraft-style game and this frame is the
 * only picture most visitors will ever see of it, so it has to look like the
 * game: real cubes, real terrain, real block colours, someone building.
 *
 * HOW IT IS DRAWN
 * One inline SVG in a 2:1 isometric projection. A cube is three polygons — a
 * top diamond and the two faces that point at the camera (+x to the lower
 * right, +z to the lower left). Terrain is a heightmap drawn as prisms: every
 * column gets its top face, and side faces only where the neighbour in front is
 * lower or missing, which carves the island's edge without drawing the hundreds
 * of cubes buried inside it.
 *
 * ⚠️ PAINTER'S ALGORITHM, NOT z-index. Isometric overlap is resolved purely by
 * draw order: `(x + z)` ascending puts far columns first, and a loose cube
 * sorts after the column it stands on. Get this wrong and the tree renders
 * through the hill in front of it.
 *
 * ⚠️ THE SCENE IS FITTED, NOT POSITIONED. Every earlier hero in this fleet was
 * hand-placed in literal pixels and then drifted off-centre the moment its
 * content changed — which is how one shipped occupying a third of its frame.
 * Here the geometry is measured and `fit()` scales it into the safe box, so the
 * heightmap below can be edited freely and the picture still fills the stage.
 *
 * ⚠️ COLOURS COME FROM THE GAME'S OWN REGISTRY (`engine/blocks`), so the hero
 * cannot drift from what the renderer actually paints. Face shading is plain
 * arithmetic on those values; the ONE thing that touches the theme is the final
 * `color-mix` with `--cal-lp-bg-1`, which is why literal block colours are safe
 * here when the house rule says tokens only — every literal is blended through
 * a token, so dark mode darkens the whole palette instead of breaking it.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */
import {
  BLOCKS,
  BRICK,
  COBBLE,
  DIRT,
  GLOWSTONE,
  GRASS,
  LEAVES,
  PLANK,
  SAND,
  STONE,
  WATER,
  WOOD,
} from '../../engine/blocks';

/* ── Projection ─────────────────────────────────────────────────────────
   A 2:1 isometric cube: TW wide, TH tall on the top diamond, CH tall on the
   two side faces. Absolute size does not matter — fit() rescales — so these
   are only about the SHAPE of a block. */
const TW = 40;
const TH = 20;
const CH = 20;

/** World y the island's underside is cut off at, giving it its thickness. */
const FLOOR = -1;

/** The box the finished scene is fitted into: clear of both caption rows. */
const SAFE = { x: 22, y: 50, w: 451, h: 258 };

/** Screen centre of the top face of the cube at world (x, y, z). */
const proj = (x: number, y: number, z: number): [number, number] => [
  (x - z) * (TW / 2),
  (x + z) * (TH / 2) - y * CH,
];

/* ── Terrain ────────────────────────────────────────────────────────────
   H[x][z] is the height of that column's top block; NONE means no column at
   all, which is what gives the island a ragged edge instead of a square slab.
   The 0s are a pond — a hole in the surface for the water to sit in.

   ⚠️ THE POND HAS TO BE AT LEAST 2x2 OR IT IS INVISIBLE. With CH equal to TH,
   a block one step nearer the camera AND one higher projects onto exactly the
   same pixels — which is real isometric occlusion, not a bug, and it means a
   one-cell hole is completely hidden behind its own front rim. A pond cell is
   only visible if the cell at (x+1, z+1) is also pond, so the water here is a
   3x3 whose back four tiles show. The first attempt was a four-cell pond and
   rendered as solid sand with no water in it at all.

   ⚠️ THE FOOTPRINT IS A LENS, NOT A SQUARE, and that is a composition
   decision, not a shape one. fit() scales to whichever axis runs out first,
   and a square island is barely wider than it is tall once the skirt and a
   tree are counted — so it fitted to HEIGHT and left a third of the stage
   empty on both sides. Spreading the map along x and cutting the z corners
   gives the scene the stage's own proportions. */
const NONE = -1;
const H: number[][] = [
  //z 0     1     2     3  4  5  6
  [NONE, NONE, NONE, 1, 1, 1, 1], // x=0
  [NONE, NONE, 1, 1, 1, 1, 1],
  [NONE, 1, 1, 2, 1, 1, 1],
  [1, 1, 2, 2, 1, 1, 1],
  [1, 2, 3, 0, 0, 0, 1],
  [1, 2, 2, 0, 0, 0, 1],
  [1, 1, 1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, NONE],
  [1, 1, 1, 1, 1, NONE, NONE],
  [1, 1, 1, 1, NONE, NONE, NONE],
  [1, 1, 1, NONE, NONE, NONE, NONE], // x=10
];
const NX = H.length;
const NZ = H[0].length;

const heightAt = (x: number, z: number): number =>
  x < 0 || z < 0 || x >= NX || z >= NZ ? NONE : H[x][z];

/** Water fills the pond, sand rings it, the hilltop is bare stone, rest grass. */
function surfaceOf(x: number, z: number): number {
  const h = H[x][z];
  if (h === 0) return WATER;
  if (h >= 3) return STONE;
  const ringsWater = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dz]) => heightAt(x + dx, z + dz) === 0);
  return ringsWater ? SAND : GRASS;
}

/* ── Loose cubes ────────────────────────────────────────────────────────
   Everything that is not terrain: the tree, the wall the other player is
   putting up, and the break-then-place beat. `anim` is one of the shared
   motion classes from landing.css; `d` is its delay. */
interface Cube {
  x: number;
  y: number;
  z: number;
  block: number;
  anim?: string;
  d?: string;
}

/**
 * ⚠️ TALL THINGS GO AT THE FRONT. A block's height moves it UP the screen and
 * its distance from the camera moves it DOWN, so a tree placed at the back of
 * the grid pokes out above everything and costs the whole island its scale,
 * while the same tree near the front costs nothing at all. This one sits deep
 * enough (x + z = 10) that its topmost leaf lands level with the hill.
 */
const TREE: [number, number] = [8, 2];
const TRUNK = H[TREE[0]][TREE[1]] + 1;

/** The wall, front right: large x, small z is the corner nearest the camera. */
const CUBES: Cube[] = [
  { x: TREE[0], y: TRUNK, z: TREE[1], block: WOOD },
  { x: TREE[0], y: TRUNK + 1, z: TREE[1], block: WOOD },
  { x: TREE[0] - 1, y: TRUNK + 2, z: TREE[1], block: LEAVES },
  { x: TREE[0] + 1, y: TRUNK + 2, z: TREE[1], block: LEAVES },
  { x: TREE[0], y: TRUNK + 2, z: TREE[1] - 1, block: LEAVES },
  { x: TREE[0], y: TRUNK + 2, z: TREE[1] + 1, block: LEAVES },
  { x: TREE[0], y: TRUNK + 2, z: TREE[1], block: LEAVES },
  { x: TREE[0], y: TRUNK + 3, z: TREE[1], block: LEAVES },

  // A boulder, so the shoreline is not uniformly green.
  { x: 2, y: 2, z: 6, block: STONE },

  // The wall, on the right shore. Three of these land while you watch — a
  // world being BUILT is the whole point of the frame, and a still picture of
  // a finished one is not the same claim.
  { x: 9, y: 2, z: 0, block: PLANK },
  { x: 10, y: 2, z: 0, block: PLANK, anim: 'cal-lp-a-in', d: '0.9s' },
  { x: 9, y: 3, z: 0, block: PLANK, anim: 'cal-lp-a-in', d: '2.3s' },
  { x: 10, y: 2, z: 1, block: BRICK },
  { x: 9, y: 2, z: 1, block: PLANK, anim: 'cal-lp-a-in', d: '3.7s' },

  // Break, then place: the cobble goes away for exactly the window the
  // glowstone appears in, on the same coordinates. `hide`/`peek` are a matched
  // pair for this — `in` would draw both at once.
  { x: 2, y: 2, z: 5, block: COBBLE, anim: 'cal-lp-a-hide', d: '1.5s' },
  { x: 2, y: 2, z: 5, block: GLOWSTONE, anim: 'cal-lp-a-peek', d: '1.5s' },
];

/* ── Palette ────────────────────────────────────────────────────────────
   `BLOCKS[id].colors` is [top, side, bottom] as rgb 0..1, straight from the
   renderer. The two lit faces are the side colour dimmed; the top is the top
   colour as-is. Everything then goes through one blend with the page
   background so the same scene works in both themes. */
const FACE_LIGHT = { t: 1, r: 0.82, l: 0.62 } as const;

function hex(c: [number, number, number], k: number): string {
  const b = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255 * k)))
      .toString(16)
      .padStart(2, '0');
  return `#${b(c[0])}${b(c[1])}${b(c[2])}`;
}

/** The one place the theme enters: every block colour is mixed into the page. */
const themed = (h: string) => `color-mix(in srgb, ${h} 88%, var(--cal-lp-bg-1))`;

const NAMES: Record<number, string> = {
  [GRASS]: 'grass',
  [DIRT]: 'dirt',
  [SAND]: 'sand',
  [WATER]: 'water',
  [STONE]: 'stone',
  [COBBLE]: 'cobble',
  [WOOD]: 'wood',
  [LEAVES]: 'leaves',
  [PLANK]: 'plank',
  [BRICK]: 'brick',
  [GLOWSTONE]: 'glowstone',
};

/** The strata under the surface, top-down, then stone all the way down. Only
    two are visible on a 1-high column, so dirt gets one course, not two. */
const STRATA = [DIRT, STONE, STONE];

/** `--mb-<name>-<face>` for every block the scene uses, set on the <svg>. */
function paletteVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  Object.entries(NAMES).forEach(([id, name]) => {
    const [top, side] = BLOCKS[Number(id)].colors;
    vars[`--mb-${name}-t`] = themed(hex(top, FACE_LIGHT.t));
    vars[`--mb-${name}-r`] = themed(hex(side, FACE_LIGHT.r));
    vars[`--mb-${name}-l`] = themed(hex(side, FACE_LIGHT.l));
  });
  return vars;
}

type Face = 't' | 'r' | 'l';
const fill = (name: string, f: Face) => ({ fill: `var(--mb-${name}-${f})` });

/* ── Drawing ────────────────────────────────────────────────────────────
   Three polygons per cube. Each one also reports its bounding box, which is
   what fit() works from. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const EMPTY: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

const pts = (p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(' ');

function topFace(cx: number, cy: number, name: string, key: string) {
  return (
    <polygon
      key={key}
      points={pts([
        [cx, cy - TH / 2],
        [cx + TW / 2, cy],
        [cx, cy + TH / 2],
        [cx - TW / 2, cy],
      ])}
      style={fill(name, 't')}
    />
  );
}

/** One block-tall slab of the +x (right) or +z (left) wall, `i` blocks down. */
function sideFace(cx: number, cy: number, i: number, name: string, side: Face, key: string) {
  const dir = side === 'r' ? 1 : -1;
  const y0 = cy + i * CH;
  return (
    <polygon
      key={key}
      points={pts([
        [cx + (dir * TW) / 2, y0],
        [cx, y0 + TH / 2],
        [cx, y0 + TH / 2 + CH],
        [cx + (dir * TW) / 2, y0 + CH],
      ])}
      style={fill(name, side)}
    />
  );
}

interface Part {
  key: number;
  nodes: React.ReactNode[];
  box: Box;
}

/**
 * A terrain column: its top face, plus the wall slabs that are actually
 * exposed. A face is exposed down to the height of the neighbour in front of
 * it — below that the neighbour's own column covers it — or all the way to
 * FLOOR where there is no neighbour, which is the island's cut edge.
 */
function column(x: number, z: number): Part {
  const h = H[x][z];
  const surface = surfaceOf(x, z);
  const [cx, cy] = proj(x, h, z);
  const nodes: React.ReactNode[] = [topFace(cx, cy, NAMES[surface], `t${x}-${z}`)];
  let deepest = 0;

  (
    [
      ['r', heightAt(x + 1, z)],
      ['l', heightAt(x, z + 1)],
    ] as [Face, number][]
  ).forEach(([side, nh]) => {
    const bottom = nh === NONE ? FLOOR : nh;
    for (let i = 0; h - 1 - i >= bottom; i += 1) {
      // Grass is only ever a TOP face — the block under it shows a dirt wall,
      // exactly as the game's own block definition says.
      const mat = NAMES[STRATA[Math.min(i, STRATA.length - 1)]];
      nodes.push(sideFace(cx, cy, i, mat, side, `${side}${x}-${z}-${i}`));
      deepest = Math.max(deepest, i + 1);
    }
  });

  return {
    key: (x + z) * 100,
    nodes,
    box: {
      x0: cx - TW / 2,
      y0: cy - TH / 2,
      x1: cx + TW / 2,
      y1: cy + TH / 2 + deepest * CH,
    },
  };
}

function cube({ x, y, z, block, anim, d }: Cube, i: number): Part {
  const [cx, cy] = proj(x, y, z);
  const name = NAMES[block];
  const faces = [
    topFace(cx, cy, name, `t${i}`),
    sideFace(cx, cy, 0, name, 'r', `r${i}`),
    sideFace(cx, cy, 0, name, 'l', `l${i}`),
  ];
  return {
    key: (x + z) * 100 + 50 + y,
    box: { x0: cx - TW / 2, y0: cy - TH / 2, x1: cx + TW / 2, y1: cy + TH / 2 + CH },
    nodes: [
      <g
        key={`c${i}`}
        className={anim}
        /* ⚠️ An SVG element's transform-origin is the viewBox origin by
           default, so the shared `scale(0.96)` in these keyframes would throw
           the cube across the frame. fill-box pins it to the cube itself. */
        style={
          anim
            ? {
                transformBox: 'fill-box',
                transformOrigin: 'center',
                ['--d' as string]: d,
                ['--t' as string]: '6s',
              }
            : undefined
        }
      >
        {faces}
      </g>,
    ],
  };
}

/** Scale + offset that lands `box` centred inside SAFE. */
function fit(box: Box) {
  const s = Math.min(SAFE.w / (box.x1 - box.x0), SAFE.h / (box.y1 - box.y0));
  return {
    s,
    dx: SAFE.x + (SAFE.w - (box.x1 - box.x0) * s) / 2 - box.x0 * s,
    dy: SAFE.y + (SAFE.h - (box.y1 - box.y0) * s) / 2 - box.y0 * s,
  };
}

export default function BlocksAnimation() {
  const parts: Part[] = [];
  for (let x = 0; x < NX; x += 1)
    for (let z = 0; z < NZ; z += 1) if (H[x][z] !== NONE) parts.push(column(x, z));
  CUBES.forEach((c, i) => parts.push(cube(c, i)));
  parts.sort((a, b) => a.key - b.key);

  const { s, dx, dy } = fit(parts.reduce((acc, p) => union(acc, p.box), EMPTY));

  // The other player, standing on the wall they are building. Put through the
  // same transform as the scene — a hand-placed avatar drifts off the wall the
  // moment the heightmap or the fit changes, which is exactly what the fit
  // exists to stop.
  const [wx, wy] = proj(9, 3, 0);
  const px = wx * s + dx;
  const py = wy * s + dy;

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>
        World · seed 4821
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>
        2 players · 41 edits
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, top: 30, fontSize: 8.5 }}>
        Terrain from the seed — only the blocks you changed are stored
      </span>

      <svg
        viewBox="0 0 495 341"
        width="495"
        height="341"
        style={{ position: 'absolute', inset: 0, ...paletteVars() }}
        /* Neighbouring polygons show a hairline gap without this, and the
           stroke doubles as the seam that makes a stack read as cubes. */
        strokeWidth={0.7}
        strokeLinejoin="round"
        stroke="color-mix(in srgb, var(--cal-lp-text) 16%, transparent)"
      >
        <g transform={`translate(${dx} ${dy}) scale(${s})`}>{parts.map((p) => p.nodes)}</g>
      </svg>

      <span
        className="cal-lp-a-txt cal-lp-a-txt--dim"
        style={{ left: px - 12, top: py - 32, fontSize: 8.5 }}
      >
        Marko
      </span>
      <span className="cal-lp-a-av" style={{ left: px - 8, top: py - 20 }}>
        M
      </span>
      <span
        className="cal-lp-a-cursor cal-lp-a-drift"
        style={{
          left: px - 62,
          top: py + 30,
          ['--dx' as string]: '34px',
          ['--dy' as string]: '-26px',
          ['--t' as string]: '6s',
        }}
      />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 3, fontSize: 8.5 }}>
        Seed + edits, no game server — the world is a context you own
      </span>
    </div>
  );
}
