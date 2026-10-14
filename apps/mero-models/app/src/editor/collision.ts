import type { MeshShape } from "./geometry";

/**
 * Collision meshes: the cheap, convex stand-ins a physics engine tests
 * against instead of the drawn mesh.
 *
 * `convexHull` wraps the mesh in its convex hull, built from at most
 * `maxPoints` of its most extreme vertices (sampled along evenly spread
 * directions), so it stays within what engines accept for a convex collider.
 * `boxHull` is the tightest axis-aligned box.
 */

type P = [number, number, number];

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function points(shape: MeshShape): P[] {
  const out: P[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < shape.positions.length; i += 3) {
    const p: P = [shape.positions[i]!, shape.positions[i + 1]!, shape.positions[i + 2]!];
    const k = p.join(",");
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

/** The most extreme point along each of `count` evenly spread directions. */
function extremes(pts: P[], count: number): P[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const chosen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const d: P = [Math.cos(i * golden) * r, y, Math.sin(i * golden) * r];
    let best = 0;
    let bestDot = -Infinity;
    pts.forEach((p, j) => {
      const v = dot(p, d);
      if (v > bestDot) {
        bestDot = v;
        best = j;
      }
    });
    chosen.add(best);
  }
  return [...chosen].map((j) => pts[j]!);
}

/** The convex hull, as an outward-facing closed triangle mesh. Null when the mesh is flat or a line. */
export function convexHull(shape: MeshShape, maxPoints = 64): MeshShape | null {
  let pts = points(shape);
  if (pts.length > maxPoints) pts = extremes(pts, Math.max(maxPoints, 4));
  if (pts.length < 4) return null;
  let span = 0;
  for (const p of pts) span = Math.max(span, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const eps = Math.max(span, 1e-6) * 1e-7;

  // A starting tetrahedron from four far-apart, non-coplanar points.
  let a = 0;
  for (let i = 1; i < pts.length; i += 1) if (pts[i]![0] < pts[a]![0]) a = i;
  let b = a;
  let far = -1;
  pts.forEach((p, i) => {
    const d = dot(sub(p, pts[a]!), sub(p, pts[a]!));
    if (d > far) {
      far = d;
      b = i;
    }
  });
  let c = -1;
  far = -1;
  pts.forEach((p, i) => {
    const n = cross(sub(pts[b]!, pts[a]!), sub(p, pts[a]!));
    const d = dot(n, n);
    if (d > far) {
      far = d;
      c = i;
    }
  });
  const base = cross(sub(pts[b]!, pts[a]!), sub(pts[c]!, pts[a]!));
  let d = -1;
  far = 0;
  pts.forEach((p, i) => {
    const h = Math.abs(dot(base, sub(p, pts[a]!)));
    if (h > far) {
      far = h;
      d = i;
    }
  });
  if (d < 0 || far <= eps * Math.sqrt(dot(base, base))) return null;

  type Face = { v: [number, number, number]; n: P; off: number };
  const make = (i: number, j: number, k: number): Face => {
    const n = cross(sub(pts[j]!, pts[i]!), sub(pts[k]!, pts[i]!));
    const l = Math.hypot(...n) || 1;
    const nn: P = [n[0] / l, n[1] / l, n[2] / l];
    return { v: [i, j, k], n: nn, off: dot(nn, pts[i]!) };
  };
  const centre: P = [0, 1, 2].map((k) => (pts[a]![k]! + pts[b]![k]! + pts[c]![k]! + pts[d]![k]!) / 4) as P;
  let faces: Face[] = [];
  for (const [i, j, k] of [[a, b, c], [a, c, d], [a, d, b], [b, d, c]] as const) {
    let f = make(i, j, k);
    if (dot(f.n, centre) - f.off > 0) f = make(i, k, j);
    faces.push(f);
  }
  const used = new Set([a, b, c, d]);
  pts.forEach((p, i) => {
    if (used.has(i)) return;
    const visible = faces.filter((f) => dot(f.n, p) - f.off > eps);
    if (!visible.length) return;
    const edges = new Set<string>();
    for (const f of visible) for (let e = 0; e < 3; e += 1) edges.add(`${f.v[e]},${f.v[(e + 1) % 3]}`);
    const horizon: [number, number][] = [];
    for (const key of edges) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      if (!edges.has(`${y},${x}`)) horizon.push([x, y]);
    }
    const keep = new Set(visible);
    faces = faces.filter((f) => !keep.has(f));
    for (const [x, y] of horizon) faces.push(make(x, y, i));
    used.add(i);
  });
  // Renumber the vertices the hull uses.
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  for (const f of faces) {
    for (const v of f.v) {
      let j = remap.get(v);
      if (j === undefined) {
        j = positions.length / 3;
        remap.set(v, j);
        positions.push(...pts[v]!);
      }
      indices.push(j);
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** The axis-aligned bounding box, as 12 outward triangles. */
export function boxHull(shape: MeshShape): MeshShape | null {
  const p = shape.positions;
  if (!p.length) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 1) {
    lo[i % 3] = Math.min(lo[i % 3]!, p[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, p[i]!);
  }
  const corner = (k: number) => [(k & 1 ? hi : lo)[0]!, (k & 2 ? hi : lo)[1]!, (k & 4 ? hi : lo)[2]!];
  const positions = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7].flatMap(corner));
  // Each side as two triangles, counter-clockwise seen from outside.
  const quads = [
    [0, 2, 3, 1], // -z
    [4, 5, 7, 6], // +z
    [0, 1, 5, 4], // -y
    [2, 6, 7, 3], // +y
    [0, 4, 6, 2], // -x
    [1, 3, 7, 5], // +x
  ];
  const indices = Uint32Array.from(quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!]));
  return { positions, indices };
}
