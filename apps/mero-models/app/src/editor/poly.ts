/**
 * The polygon cage: what a modeller edits.
 *
 * A mesh blob used to hold only triangles. Game assets are modelled in quads
 * and n-gons — edge loops, rings, loop cuts and bevels only mean something on
 * them — and triangulated at export. So a mesh can now carry its cage: faces
 * of any size, a UV per face corner (so a seam is just two corners with
 * different UVs, never two vertices), the edges marked sharp (hard), and a
 * stack of modifiers evaluated on top. The triangles the viewport draws are
 * derived from it (`polymesh.ts`).
 *
 * Plain arrays rather than typed ones: every tool here rebuilds faces of
 * varying length, and a cage worth editing in a browser is at most a few
 * hundred thousand vertices.
 *
 * Every function is pure — a cage in, a new cage out — and never mutates its
 * input, so the undo history can hold on to old cages.
 */

export type Axis = 0 | 1 | 2;

export type Modifier =
  | { type: "mirror"; axis: Axis; weld: number; on: boolean }
  | { type: "subdivision"; levels: number; on: boolean }
  | { type: "array"; count: number; offset: [number, number, number]; on: boolean }
  | { type: "solidify"; thickness: number; on: boolean };

export interface Poly {
  /** x, y, z per vertex. */
  positions: number[];
  /** Vertex indices per face, counter-clockwise seen from outside. */
  faces: number[][];
  /** u, v per corner of each face (`uvs[f].length === faces[f].length * 2`), or null for no UVs. */
  uvs: number[][] | null;
  /** Hard edges, as `edgeKey`s. */
  sharp: Set<number>;
  modifiers: Modifier[];
}

const SPAN = 67_108_864; // 2^26: vertex indices stay well under it

/** An undirected edge as one number. */
export const edgeKey = (a: number, b: number): number => (a < b ? a * SPAN + b : b * SPAN + a);
/** A directed edge as one number. */
export const dirKey = (a: number, b: number): number => a * SPAN + b;
export const edgeEnds = (key: number): [number, number] => [Math.floor(key / SPAN), key % SPAN];

export const vertexTotal = (p: Poly): number => p.positions.length / 3;
export const cornerTotal = (p: Poly): number => p.faces.reduce((n, f) => n + f.length, 0);
/** Triangles the cage becomes: n − 2 per face, however it is triangulated. */
export const triangleTotal = (p: Poly): number => p.faces.reduce((n, f) => n + f.length - 2, 0);

export function emptyPoly(): Poly {
  return { positions: [], faces: [], uvs: null, sharp: new Set(), modifiers: [] };
}

// ── vectors on the flat position array ─────────────────────────────────────

export type V3 = [number, number, number];

export const at = (p: Poly, i: number): V3 => [p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Face normal by Newell's method: right for concave and slightly non-planar faces too. Not normalised. */
export function faceNormalRaw(p: Poly, face: number[]): V3 {
  let x = 0, y = 0, z = 0;
  const q = p.positions;
  for (let i = 0; i < face.length; i += 1) {
    const c = face[i]! * 3;
    const n = face[(i + 1) % face.length]! * 3;
    x += (q[c + 1]! - q[n + 1]!) * (q[c + 2]! + q[n + 2]!);
    y += (q[c + 2]! - q[n + 2]!) * (q[c]! + q[n]!);
    z += (q[c]! - q[n]!) * (q[c + 1]! + q[n + 1]!);
  }
  return [x, y, z];
}

export const faceNormal = (p: Poly, face: number[]): V3 => norm(faceNormalRaw(p, face));

export function faceCenter(p: Poly, face: number[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const v of face) {
    c[0] += p.positions[v * 3]!;
    c[1] += p.positions[v * 3 + 1]!;
    c[2] += p.positions[v * 3 + 2]!;
  }
  return scale(c, 1 / face.length);
}

/** The UV of corner `c` of face `f`, or null when the cage has none. */
export function cornerUv(p: Poly, f: number, c: number): [number, number] | null {
  const uv = p.uvs?.[f];
  if (!uv) return null;
  const k = ((c % (uv.length / 2)) + uv.length / 2) % (uv.length / 2);
  return [uv[k * 2]!, uv[k * 2 + 1]!];
}

// ── topology ───────────────────────────────────────────────────────────────

export interface Topology {
  /** Undirected edge → the faces that use it. */
  edgeFaces: Map<number, number[]>;
  /** Directed edge a→b → [face, corner of a]. */
  directed: Map<number, [number, number]>;
  /** Vertex → neighbouring vertices. */
  neighbours: number[][];
  /** Vertex → faces using it. */
  vertexFaces: number[][];
}

const topoCache = new WeakMap<Poly, Topology>();

/** Adjacency of a cage, computed once per cage (cages are never mutated). */
export function topology(p: Poly): Topology {
  const cached = topoCache.get(p);
  if (cached) return cached;
  const n = vertexTotal(p);
  const edgeFaces = new Map<number, number[]>();
  const directed = new Map<number, [number, number]>();
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  const vertexFaces: number[][] = Array.from({ length: n }, () => []);
  p.faces.forEach((face, f) => {
    for (let c = 0; c < face.length; c += 1) {
      const a = face[c]!;
      const b = face[(c + 1) % face.length]!;
      vertexFaces[a]!.push(f);
      const key = edgeKey(a, b);
      const list = edgeFaces.get(key);
      if (list) list.push(f);
      else {
        edgeFaces.set(key, [f]);
        neighbours[a]!.push(b);
        neighbours[b]!.push(a);
      }
      directed.set(dirKey(a, b), [f, c]);
    }
  });
  const t = { edgeFaces, directed, neighbours, vertexFaces };
  topoCache.set(p, t);
  return t;
}

/** Every edge once, as keys. */
export function edgeList(p: Poly): number[] {
  return [...topology(p).edgeFaces.keys()];
}

// ── building ───────────────────────────────────────────────────────────────

/** Accumulates a new cage from an old one. Vertices start as the old cage's. */
export class Build {
  positions: number[];
  faces: number[][] = [];
  uvs: number[][] | null;
  sharp: Set<number>;

  constructor(src: Poly, keepSharp = true) {
    this.positions = src.positions.slice();
    this.uvs = src.uvs ? [] : null;
    this.sharp = keepSharp ? new Set(src.sharp) : new Set();
  }

  vert(v: V3): number {
    this.positions.push(v[0], v[1], v[2]);
    return this.positions.length / 3 - 1;
  }

  at(i: number): V3 {
    return [this.positions[i * 3]!, this.positions[i * 3 + 1]!, this.positions[i * 3 + 2]!];
  }

  move(i: number, v: V3): void {
    this.positions[i * 3] = v[0];
    this.positions[i * 3 + 1] = v[1];
    this.positions[i * 3 + 2] = v[2];
  }

  /** Add a face; consecutive repeats are dropped and a face of fewer than 3 corners is not added. Returns its index or -1. */
  face(verts: number[], uv?: number[] | null): number {
    const vs: number[] = [];
    const us: number[] = [];
    for (let i = 0; i < verts.length; i += 1) {
      const v = verts[i]!;
      if (vs.length && vs[vs.length - 1] === v) continue;
      vs.push(v);
      if (uv) us.push(uv[i * 2] ?? 0, uv[i * 2 + 1] ?? 0);
    }
    while (vs.length > 1 && vs[0] === vs[vs.length - 1]) {
      vs.pop();
      us.splice(us.length - 2, 2);
    }
    if (vs.length < 3) return -1;
    this.faces.push(vs);
    if (this.uvs) this.uvs.push(uv ? us : new Array(vs.length * 2).fill(0));
    return this.faces.length - 1;
  }

  done(modifiers: Modifier[]): Poly {
    return {
      positions: this.positions,
      faces: this.faces,
      uvs: this.uvs,
      sharp: this.sharp,
      modifiers: modifiers.map((m) => ({ ...m })) as Modifier[],
    };
  }
}

/**
 * Drop vertices no face uses and renumber the rest; sharp marks on edges that
 * no longer exist go too. `remap[old]` is the new index or -1.
 */
export function compactPoly(p: Poly): { poly: Poly; remap: Int32Array } {
  const n = vertexTotal(p);
  const remap = new Int32Array(n).fill(-1);
  let next = 0;
  for (const face of p.faces) for (const v of face) if (remap[v] === -1) remap[v] = next++;
  const positions = new Array<number>(next * 3);
  for (let i = 0; i < n; i += 1) {
    const j = remap[i]!;
    if (j < 0) continue;
    positions[j * 3] = p.positions[i * 3]!;
    positions[j * 3 + 1] = p.positions[i * 3 + 1]!;
    positions[j * 3 + 2] = p.positions[i * 3 + 2]!;
  }
  const faces = p.faces.map((f) => f.map((v) => remap[v]!));
  const edges = new Set<number>();
  for (const f of faces) for (let c = 0; c < f.length; c += 1) edges.add(edgeKey(f[c]!, f[(c + 1) % f.length]!));
  const sharp = new Set<number>();
  for (const key of p.sharp) {
    const [a, b] = edgeEnds(key);
    if (a >= n || b >= n) continue;
    const k = edgeKey(remap[a]!, remap[b]!);
    if (remap[a]! >= 0 && remap[b]! >= 0 && edges.has(k)) sharp.add(k);
  }
  return { poly: { positions, faces, uvs: p.uvs, sharp, modifiers: p.modifiers }, remap };
}

/** The same cage with other vertex positions (a drag). Topology, and so its cache, is shared. */
export function withPositions(p: Poly, positions: number[]): Poly {
  const next = { ...p, positions };
  const t = topoCache.get(p);
  if (t) topoCache.set(next, t);
  return next;
}

export function withModifiers(p: Poly, modifiers: Modifier[]): Poly {
  const next = { ...p, modifiers };
  const t = topoCache.get(p);
  if (t) topoCache.set(next, t);
  return next;
}

// ── selection helpers ──────────────────────────────────────────────────────

/** Faces whose every corner is selected. */
export function facesOfVerts(p: Poly, verts: Set<number>): Set<number> {
  const out = new Set<number>();
  p.faces.forEach((f, i) => {
    if (f.every((v) => verts.has(v))) out.add(i);
  });
  return out;
}

export function vertsOfFaces(p: Poly, faces: Iterable<number>): Set<number> {
  const out = new Set<number>();
  for (const f of faces) for (const v of p.faces[f] ?? []) out.add(v);
  return out;
}

/** Edges with both ends selected. */
export function edgesOfVerts(p: Poly, verts: Set<number>): Set<number> {
  const out = new Set<number>();
  for (const key of topology(p).edgeFaces.keys()) {
    const [a, b] = edgeEnds(key);
    if (verts.has(a) && verts.has(b)) out.add(key);
  }
  return out;
}

export function vertsOfEdges(edges: Iterable<number>): Set<number> {
  const out = new Set<number>();
  for (const key of edges) {
    const [a, b] = edgeEnds(key);
    out.add(a).add(b);
  }
  return out;
}

export function unionFind(n: number): { find(x: number): number; union(a: number, b: number): void } {
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  return {
    find,
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    },
  };
}
