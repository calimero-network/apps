import type { MeshShape } from "./geometry";

/**
 * Levels of detail: the same mesh with fewer triangles, for the distance.
 *
 * Quadric error metrics (Garland & Heckbert): every vertex carries the sum of
 * the squared distances to the planes of its faces; collapsing an edge onto
 * one of its ends costs the error the merged vertex would have there; the
 * cheapest collapse goes first.
 *
 * It works on the triangles a mesh is drawn with, where a UV seam or a hard
 * edge is two vertices at one position. A collapse is only allowed when every
 * copy of the vertex that moves has a copy of the vertex it moves onto across
 * one of its own triangles — so a seam slides along itself but never tears,
 * and the UVs stay those of real vertices. Open borders are held by extra
 * planes, and a collapse that would turn a triangle over is refused.
 */

export interface LodResult {
  shape: MeshShape;
  /** Triangles in and out. */
  from: number;
  to: number;
}

type Quadric = Float64Array; // a, b, c, d of Σ (n·p + d)² as a symmetric 4×4: 10 entries

function addPlane(q: Quadric, o: number, a: number, b: number, c: number, d: number, w: number): void {
  q[o] = q[o]! + w * a * a;
  q[o + 1] = q[o + 1]! + w * a * b;
  q[o + 2] = q[o + 2]! + w * a * c;
  q[o + 3] = q[o + 3]! + w * a * d;
  q[o + 4] = q[o + 4]! + w * b * b;
  q[o + 5] = q[o + 5]! + w * b * c;
  q[o + 6] = q[o + 6]! + w * b * d;
  q[o + 7] = q[o + 7]! + w * c * c;
  q[o + 8] = q[o + 8]! + w * c * d;
  q[o + 9] = q[o + 9]! + w * d * d;
}

function evalQ(q: Quadric, o: number, p: number, x: number, y: number, z: number): number {
  // Sum of the two vertices' quadrics at (x, y, z).
  const e = (i: number) => q[o + i]! + q[p + i]!;
  return (
    e(0) * x * x + 2 * e(1) * x * y + 2 * e(2) * x * z + 2 * e(3) * x +
    e(4) * y * y + 2 * e(5) * y * z + 2 * e(6) * y +
    e(7) * z * z + 2 * e(8) * z +
    e(9)
  );
}

/** A min-heap of candidate collapses, invalidated lazily by version. */
class Heap {
  private cost: number[] = [];
  private from: number[] = [];
  private to: number[] = [];
  private stamp: number[] = [];
  get size(): number {
    return this.cost.length;
  }
  push(cost: number, from: number, to: number, stamp: number): void {
    this.cost.push(cost);
    this.from.push(from);
    this.to.push(to);
    this.stamp.push(stamp);
    let i = this.cost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p]! <= this.cost[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): { cost: number; from: number; to: number; stamp: number } {
    const top = { cost: this.cost[0]!, from: this.from[0]!, to: this.to[0]!, stamp: this.stamp[0]! };
    const last = this.cost.length - 1;
    this.swap(0, last);
    this.cost.pop();
    this.from.pop();
    this.to.pop();
    this.stamp.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.cost.length && this.cost[l]! < this.cost[m]!) m = l;
      if (r < this.cost.length && this.cost[r]! < this.cost[m]!) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private swap(a: number, b: number): void {
    for (const arr of [this.cost, this.from, this.to, this.stamp]) [arr[a], arr[b]] = [arr[b]!, arr[a]!];
  }
}

/** Simplify `shape` to at most `ratio` of its triangles (or as near as seams and borders allow). */
export function simplify(shape: MeshShape, ratio: number): LodResult {
  const P = shape.positions;
  const I = shape.indices;
  const triCount = I.length / 3;
  const target = Math.max(4, Math.floor(triCount * Math.max(0, Math.min(1, ratio))));
  if (target >= triCount) return { shape: { positions: P, indices: I, uvs: shape.uvs }, from: triCount, to: triCount };

  // Positions: render vertices at one point are one position.
  const renderCount = P.length / 3;
  const posOf = new Int32Array(renderCount);
  const key = new Map<string, number>();
  const pos: number[] = [];
  for (let r = 0; r < renderCount; r += 1) {
    const k = `${P[r * 3]},${P[r * 3 + 1]},${P[r * 3 + 2]}`;
    let id = key.get(k);
    if (id === undefined) {
      id = pos.length / 3;
      key.set(k, id);
      pos.push(P[r * 3]!, P[r * 3 + 1]!, P[r * 3 + 2]!);
    }
    posOf[r] = id;
  }
  const n = pos.length / 3;
  const tris = Int32Array.from(I);
  const alive = new Uint8Array(triCount).fill(1);
  // Triangles around each position.
  const around: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < triCount; t += 1) for (let j = 0; j < 3; j += 1) around[posOf[tris[t * 3 + j]!]!]!.add(t);

  const q = new Float64Array(n * 10);
  const normalOf = (t: number): [number, number, number, number] => {
    const a = posOf[tris[t * 3]!]! * 3, b = posOf[tris[t * 3 + 1]!]! * 3, c = posOf[tris[t * 3 + 2]!]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    return l > 0 ? [nx / l, ny / l, nz / l, l / 2] : [0, 0, 0, 0];
  };
  const edgeUse = new Map<number, number>();
  const ek = (a: number, b: number) => (a < b ? a * 67_108_864 + b : b * 67_108_864 + a);
  for (let t = 0; t < triCount; t += 1) {
    const [nx, ny, nz, area] = normalOf(t);
    if (!area) continue;
    const a = posOf[tris[t * 3]!]!;
    const d = -(nx * pos[a * 3]! + ny * pos[a * 3 + 1]! + nz * pos[a * 3 + 2]!);
    for (let j = 0; j < 3; j += 1) addPlane(q, posOf[tris[t * 3 + j]!]! * 10, nx, ny, nz, d, area);
    for (let j = 0; j < 3; j += 1) {
      const k = ek(posOf[tris[t * 3 + j]!]!, posOf[tris[t * 3 + ((j + 1) % 3)]!]!);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  // Open borders: a steep plane through each border edge keeps it where it is.
  for (let t = 0; t < triCount; t += 1) {
    const [nx, ny, nz, area] = normalOf(t);
    if (!area) continue;
    for (let j = 0; j < 3; j += 1) {
      const a = posOf[tris[t * 3 + j]!]!, b = posOf[tris[t * 3 + ((j + 1) % 3)]!]!;
      if (edgeUse.get(ek(a, b)) !== 1) continue;
      const ex = pos[b * 3]! - pos[a * 3]!, ey = pos[b * 3 + 1]! - pos[a * 3 + 1]!, ez = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
      let px = ey * nz - ez * ny, py = ez * nx - ex * nz, pz = ex * ny - ey * nx;
      const l = Math.hypot(px, py, pz) || 1;
      px /= l;
      py /= l;
      pz /= l;
      const d = -(px * pos[a * 3]! + py * pos[a * 3 + 1]! + pz * pos[a * 3 + 2]!);
      const w = 1000 * Math.max(area, 1e-9);
      addPlane(q, a * 10, px, py, pz, d, w);
      addPlane(q, b * 10, px, py, pz, d, w);
    }
  }

  const version = new Int32Array(n);
  const gone = new Uint8Array(n);
  const heap = new Heap();
  const neighbours = (u: number) => {
    const out = new Set<number>();
    for (const t of around[u]!) for (let j = 0; j < 3; j += 1) out.add(posOf[tris[t * 3 + j]!]!);
    out.delete(u);
    return out;
  };
  const consider = (u: number) => {
    for (const v of neighbours(u)) {
      heap.push(evalQ(q, u * 10, v * 10, pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!), u, v, version[u]! + version[v]! * 65536);
    }
  };
  for (let u = 0; u < n; u += 1) consider(u);

  /**
   * Where each render copy of `u` goes when `u` collapses onto `v`, or null
   * when some copy has no copy of `v` across one of its triangles (it would
   * tear a seam).
   */
  const remapFor = (u: number, v: number): Map<number, number> | null => {
    const map = new Map<number, number>();
    for (const t of around[u]!) {
      let ru = -1;
      let rv = -1;
      for (let j = 0; j < 3; j += 1) {
        const r = tris[t * 3 + j]!;
        if (posOf[r] === u) ru = r;
        if (posOf[r] === v) rv = r;
      }
      if (rv >= 0) {
        const prior = map.get(ru);
        if (prior !== undefined && prior !== rv) return null;
        map.set(ru, rv);
      }
    }
    for (const t of around[u]!) {
      for (let j = 0; j < 3; j += 1) {
        const r = tris[t * 3 + j]!;
        if (posOf[r] === u && !map.has(r)) return null;
      }
    }
    return map;
  };

  let live = triCount;
  while (live > target && heap.size) {
    const c = heap.pop();
    const { from: u, to: v } = c;
    if (gone[u] || gone[v] || c.stamp !== version[u]! + version[v]! * 65536) continue;
    const map = remapFor(u, v);
    if (!map) continue;
    // Refuse a collapse that turns any surviving triangle over.
    let flips = false;
    for (const t of around[u]!) {
      const hasV = [0, 1, 2].some((j) => posOf[tris[t * 3 + j]!] === v);
      if (hasV) continue;
      const before = normalOf(t);
      const saved = [tris[t * 3]!, tris[t * 3 + 1]!, tris[t * 3 + 2]!];
      for (let j = 0; j < 3; j += 1) if (posOf[tris[t * 3 + j]!] === u) tris[t * 3 + j] = map.get(tris[t * 3 + j]!) ?? tris[t * 3 + j]!;
      const after = normalOf(t);
      tris.set(saved, t * 3);
      if (!after[3] || before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0.2) {
        flips = true;
        break;
      }
    }
    if (flips) continue;
    // Collapse.
    for (const t of [...around[u]!]) {
      const hasV = [0, 1, 2].some((j) => posOf[tris[t * 3 + j]!] === v);
      if (hasV) {
        alive[t] = 0;
        live -= 1;
        for (let j = 0; j < 3; j += 1) around[posOf[tris[t * 3 + j]!]!]!.delete(t);
        continue;
      }
      for (let j = 0; j < 3; j += 1) if (posOf[tris[t * 3 + j]!] === u) tris[t * 3 + j] = map.get(tris[t * 3 + j]!)!;
      around[v]!.add(t);
    }
    around[u]!.clear();
    gone[u] = 1;
    for (let i = 0; i < 10; i += 1) q[v * 10 + i] = q[v * 10 + i]! + q[u * 10 + i]!;
    version[v] = version[v]! + 1;
    for (const w of neighbours(v)) version[w] = version[w]! + 1;
    consider(v);
    for (const w of neighbours(v)) consider(w);
  }

  // Compact the surviving render vertices.
  const remap = new Int32Array(renderCount).fill(-1);
  const indices: number[] = [];
  let next = 0;
  for (let t = 0; t < triCount; t += 1) {
    if (!alive[t]) continue;
    for (let j = 0; j < 3; j += 1) {
      const r = tris[t * 3 + j]!;
      if (remap[r] === -1) remap[r] = next++;
      indices.push(remap[r]!);
    }
  }
  const positions = new Float32Array(next * 3);
  const uvs = shape.uvs ? new Float32Array(next * 2) : undefined;
  for (let r = 0; r < renderCount; r += 1) {
    const j = remap[r]!;
    if (j < 0) continue;
    positions.set(P.subarray(r * 3, r * 3 + 3), j * 3);
    if (uvs) uvs.set(shape.uvs!.subarray(r * 2, r * 2 + 2), j * 2);
  }
  const out: MeshShape = { positions, indices: Uint32Array.from(indices) };
  if (uvs) out.uvs = uvs;
  return { shape: out, from: triCount, to: indices.length / 3 };
}
