import { evaluate } from "./modifiers";
import { dot, faceCenter, faceNormal, norm, sub, topology, withModifiers, type Poly, type V3 } from "./poly";
import { triangulateFace } from "./polymesh";

/**
 * Texture baking: properties of a mesh's surface written into its UV space,
 * one texel at a time, as the masks a smart material is built from.
 *
 * - ambient occlusion — how much of the sky each point sees, by ray tracing
 *   the mesh against itself (a small BVH below);
 * - edges and cavities — how close each point is to a convex (wear) or
 *   concave (dirt) edge of its face, in metres;
 * - height, the up-facing amount and the object-space position, for masks
 *   and seamless 3D noise;
 * - a tangent-space normal map from a high-poly surface onto this one, the
 *   classic game workflow (subdivided or sculpted detail on a light mesh).
 *
 * Every map is padded a few texels past its islands, so filtering at a UV
 * seam never reaches the background.
 */

export interface BakeOptions {
  /** Texels a side. */
  size: number;
  /** Ambient occlusion: rays per texel (0 skips it), and how far they look as a share of the mesh's size. */
  aoSamples: number;
  aoDistance: number;
  /** AO is traced at most this many texels a side (by default a quarter of `size`, 128–512) and filtered up. */
  aoMaxSize?: number;
  /** Width of the edge and cavity masks, in metres. */
  edgeWidth: number;
  /** A surface to bake normals from, in this mesh's space, and how far from the surface to look for it. */
  high?: Poly | null;
  cageDistance?: number;
}

export interface BakeMaps {
  size: number;
  /** 1 where a texel is on the surface (before padding). */
  coverage: Uint8Array;
  /** Share of covered texels that more than one face claimed: overlapping UVs. */
  overlap: number;
  ao: Float32Array;
  edges: Float32Array;
  cavity: Float32Array;
  /** 0 at the mesh's bottom, 1 at its top. */
  height: Float32Array;
  /** How much the surface faces up, 0–1. */
  up: Float32Array;
  /** Object-space position, xyz per texel. */
  position: Float32Array;
  /** Tangent-space normal, xyz per texel (unit vectors); flat (0,0,1) without a high-poly source. */
  normal: Float32Array;
  /** The UV-space slopes of the surface's own tangent frame: tangent then bitangent, xyz each, per texel. */
  tangents: Float32Array;
  /** Metres of surface per unit of UV, on average (packing makes it nearly even). */
  metresPerUv: number;
}

export class BakeError extends Error {}

// ── triangles ───────────────────────────────────────────────────────────────

interface Tris {
  count: number;
  /** xyz × 3 corners per triangle. */
  pos: Float32Array;
  /** Smooth (shading) normals per corner, xyz × 3. */
  nrm: Float32Array;
  /** uv × 3 corners. */
  uv: Float32Array;
  face: Int32Array;
}

/**
 * The surface as triangles with the normals it is shaded with: corners
 * around a vertex share a normal unless a hard edge (or a steep one, as in
 * the viewport) separates them.
 */
function trianglesOf(p: Poly): Tris {
  const t = topology(p);
  const faceN = p.faces.map((f) => faceNormal(p, f));
  const sharpAt = (a: number, b: number, f: number, g: number) =>
    p.sharp.has(Math.min(a, b) * 67_108_864 + Math.max(a, b)) || dot(faceN[f]!, faceN[g]!) < 0.5;
  // Smooth normal of a corner: area-weighted over faces reachable around its vertex without crossing a hard edge.
  const cornerNormal = (f: number, c: number): V3 => {
    const v = p.faces[f]![c]!;
    let n: V3 = [0, 0, 0];
    const seen = new Set<number>([f]);
    const stack = [f];
    while (stack.length) {
      const g = stack.pop()!;
      const fn = faceN[g]!;
      n = [n[0] + fn[0], n[1] + fn[1], n[2] + fn[2]];
      const face = p.faces[g]!;
      const k = face.indexOf(v);
      for (const w of [face[(k + 1) % face.length]!, face[(k - 1 + face.length) % face.length]!]) {
        for (const h of t.edgeFaces.get(Math.min(v, w) * 67_108_864 + Math.max(v, w)) ?? []) {
          if (!seen.has(h) && !sharpAt(v, w, g, h)) {
            seen.add(h);
            stack.push(h);
          }
        }
      }
    }
    return norm(n);
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const face: number[] = [];
  p.faces.forEach((f, fi) => {
    const tris = triangulateFace(p, f);
    const normals = f.map((_, c) => cornerNormal(fi, c));
    for (let k = 0; k < tris.length; k += 3) {
      for (let j = 0; j < 3; j += 1) {
        const c = tris[k + j]!;
        const v = f[c]!;
        pos.push(p.positions[v * 3]!, p.positions[v * 3 + 1]!, p.positions[v * 3 + 2]!);
        nrm.push(...normals[c]!);
        const u = p.uvs?.[fi];
        uv.push(u ? u[c * 2]! : 0, u ? u[c * 2 + 1]! : 0);
      }
      face.push(fi);
    }
  });
  return { count: face.length, pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), uv: Float32Array.from(uv), face: Int32Array.from(face) };
}

// ── BVH ─────────────────────────────────────────────────────────────────────

/** A bounding-volume hierarchy over triangles, for the rays AO and normal baking cast. */
export class Bvh {
  private readonly min: Float32Array;
  private readonly max: Float32Array;
  /** Per node: left child (or -1 for a leaf), right child, first triangle, triangle count. */
  private readonly nodes: Int32Array;
  private readonly order: Int32Array;
  private nodeCount = 0;
  private readonly stack = new Int32Array(128);

  constructor(private readonly tris: Tris) {
    const n = tris.count;
    this.order = new Int32Array(n).map((_, i) => i);
    const cap = Math.max(1, n * 2);
    this.min = new Float32Array(cap * 3);
    this.max = new Float32Array(cap * 3);
    this.nodes = new Int32Array(cap * 4);
    const centroid = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < 3; k += 1) centroid[i * 3 + k] = (tris.pos[i * 9 + k]! + tris.pos[i * 9 + 3 + k]! + tris.pos[i * 9 + 6 + k]!) / 3;
    }
    if (n) this.build(0, n, centroid);
  }

  private build(start: number, end: number, centroid: Float32Array): number {
    const id = this.nodeCount++;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const clo = [Infinity, Infinity, Infinity];
    const chi = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i += 1) {
      const t = this.order[i]!;
      for (let c = 0; c < 3; c += 1) {
        for (let k = 0; k < 3; k += 1) {
          const x = this.tris.pos[t * 9 + c * 3 + k]!;
          if (x < lo[k]!) lo[k] = x;
          if (x > hi[k]!) hi[k] = x;
        }
      }
      for (let k = 0; k < 3; k += 1) {
        const x = centroid[t * 3 + k]!;
        if (x < clo[k]!) clo[k] = x;
        if (x > chi[k]!) chi[k] = x;
      }
    }
    for (let k = 0; k < 3; k += 1) {
      this.min[id * 3 + k] = lo[k]!;
      this.max[id * 3 + k] = hi[k]!;
    }
    const count = end - start;
    if (count <= 4) {
      this.nodes.set([-1, -1, start, count], id * 4);
      return id;
    }
    const axis = chi[0]! - clo[0]! >= chi[1]! - clo[1]! && chi[0]! - clo[0]! >= chi[2]! - clo[2]! ? 0 : chi[1]! - clo[1]! >= chi[2]! - clo[2]! ? 1 : 2;
    const sub = Array.from(this.order.subarray(start, end)).sort((a, b) => centroid[a * 3 + axis]! - centroid[b * 3 + axis]!);
    this.order.set(sub, start);
    const mid = start + (count >> 1);
    const left = this.build(start, mid, centroid);
    const right = this.build(mid, end, centroid);
    this.nodes.set([left, right, start, count], id * 4);
    return id;
  }

  /**
   * The nearest hit along a ray within `tMax`: distance, triangle and the
   * barycentric weights of its second and third corners — or null.
   * `any` returns the first hit found (enough for occlusion).
   */
  cast(o: V3, d: V3, tMax: number, any = false): { t: number; tri: number; u: number; v: number } | null {
    if (!this.nodeCount) return null;
    const ix = 1 / d[0], iy = 1 / d[1], iz = 1 / d[2];
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    let best: { t: number; tri: number; u: number; v: number } | null = null;
    let limit = tMax;
    const P = this.tris.pos;
    while (sp) {
      const node = stack[--sp]!;
      // Slab test, unrolled.
      const m = node * 3;
      let a = (this.min[m]! - o[0]) * ix, b = (this.max[m]! - o[0]) * ix;
      let t0 = a < b ? a : b, t1 = a < b ? b : a;
      if (t1 > limit) t1 = limit;
      if (t0 < 0) t0 = 0;
      a = (this.min[m + 1]! - o[1]) * iy;
      b = (this.max[m + 1]! - o[1]) * iy;
      t0 = Math.max(t0, a < b ? a : b);
      t1 = Math.min(t1, a < b ? b : a);
      if (t0 > t1) continue;
      a = (this.min[m + 2]! - o[2]) * iz;
      b = (this.max[m + 2]! - o[2]) * iz;
      t0 = Math.max(t0, a < b ? a : b);
      t1 = Math.min(t1, a < b ? b : a);
      if (t0 > t1) continue;
      const left = this.nodes[node * 4]!;
      if (left >= 0) {
        stack[sp++] = left;
        stack[sp++] = this.nodes[node * 4 + 1]!;
        continue;
      }
      const first = this.nodes[node * 4 + 2]!;
      const count = this.nodes[node * 4 + 3]!;
      for (let i = first; i < first + count; i += 1) {
        const tri = this.order[i]!;
        const b = tri * 9;
        // Möller–Trumbore.
        const e1x = P[b + 3]! - P[b]!, e1y = P[b + 4]! - P[b + 1]!, e1z = P[b + 5]! - P[b + 2]!;
        const e2x = P[b + 6]! - P[b]!, e2y = P[b + 7]! - P[b + 1]!, e2z = P[b + 8]! - P[b + 2]!;
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const id = 1 / det;
        const tx = o[0] - P[b]!, ty = o[1] - P[b + 1]!, tz = o[2] - P[b + 2]!;
        const u = (tx * px + ty * py + tz * pz) * id;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * id;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * id;
        if (t <= 1e-6 || t >= limit) continue;
        best = { t, tri, u, v };
        if (any) return best;
        limit = t;
      }
    }
    return best;
  }

  /** The shading normal at a hit. */
  normalAt(hit: { tri: number; u: number; v: number }): V3 {
    const N = this.tris.nrm;
    const b = hit.tri * 9;
    const w = 1 - hit.u - hit.v;
    return norm([
      N[b]! * w + N[b + 3]! * hit.u + N[b + 6]! * hit.v,
      N[b + 1]! * w + N[b + 4]! * hit.u + N[b + 7]! * hit.v,
      N[b + 2]! * w + N[b + 5]! * hit.u + N[b + 8]! * hit.v,
    ]);
  }
}

// ── sampling ────────────────────────────────────────────────────────────────

/** Deterministic low-discrepancy directions (a Fibonacci hemisphere), cosine-weighted about +Z. */
function hemisphere(count: number): V3[] {
  const out: V3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const r = Math.sqrt((i + 0.5) / count);
    const a = i * golden;
    out.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return out;
}

function basis(n: V3): [V3, V3] {
  const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t = norm([a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]]);
  const b: V3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  return [t, b];
}

const yieldNow = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ── the bake ────────────────────────────────────────────────────────────────

/** Edges of a face that wear (convex) or gather dirt (concave), with how strongly. */
function faceEdges(p: Poly): { a: V3; b: V3; convex: number; concave: number }[][] {
  const t = topology(p);
  const normals = p.faces.map((f) => faceNormal(p, f));
  const centres = p.faces.map((f) => faceCenter(p, f));
  return p.faces.map((face, f) =>
    face.map((v, c) => {
      const w = face[(c + 1) % face.length]!;
      const key = Math.min(v, w) * 67_108_864 + Math.max(v, w);
      const others = (t.edgeFaces.get(key) ?? []).filter((g) => g !== f);
      const a: V3 = [p.positions[v * 3]!, p.positions[v * 3 + 1]!, p.positions[v * 3 + 2]!];
      const b: V3 = [p.positions[w * 3]!, p.positions[w * 3 + 1]!, p.positions[w * 3 + 2]!];
      if (!others.length) return { a, b, convex: 1, concave: 0 }; // an open border wears like an edge
      const g = others[0]!;
      const bend = Math.acos(Math.max(-1, Math.min(1, dot(normals[f]!, normals[g]!))));
      // Full strength from 30° of bend; nothing below 10°.
      const strength = Math.max(0, Math.min(1, (bend - 0.17) / 0.35));
      const convex = dot(normals[f]!, sub(centres[g]!, centres[f]!)) < 0;
      return { a, b, convex: convex ? strength : 0, concave: convex ? 0 : strength };
    }),
  );
}

function segmentDistance(p: V3, a: V3, b: V3): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const l = dot(ab, ab);
  const t = l > 0 ? Math.max(0, Math.min(1, dot(ap, ab) / l)) : 0;
  const dx = ap[0] - ab[0] * t, dy = ap[1] - ab[1] * t, dz = ap[2] - ab[2] * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const smooth01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Bake every map for the surface `p` draws (its modifiers applied), in its
 * UV space. `onProgress` hears a stage and 0–1 as it goes; the work yields to
 * the page regularly.
 */
export async function bake(p: Poly, opts: BakeOptions, onProgress?: (stage: string, done: number) => void): Promise<BakeMaps> {
  const surface = withModifiers(evaluate(p).poly, []);
  if (!surface.uvs) throw new BakeError("This mesh has no UVs — unwrap it (U) or smart project it first.");
  const size = Math.max(16, Math.min(4096, Math.round(opts.size)));
  const tris = trianglesOf(surface);
  const edges = faceEdges(surface);
  const texels = size * size;
  const coverage = new Uint8Array(texels);
  const claims = new Uint8Array(texels);
  const tri = new Int32Array(texels).fill(-1);
  const bary = new Float32Array(texels * 2);

  // 1. Rasterise: which triangle (and where in it) each texel centre lands on.
  for (let i = 0; i < tris.count; i += 1) {
    const U = tris.uv;
    const ax = U[i * 6]! * size, ay = (1 - U[i * 6 + 1]!) * size;
    const bx = U[i * 6 + 2]! * size, by = (1 - U[i * 6 + 3]!) * size;
    const cx = U[i * 6 + 4]! * size, cy = (1 - U[i * 6 + 5]!) * size;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5, py = y + 0.5;
        const w1 = ((cx - ax) * (py - ay) - (cy - ay) * (px - ax)) / -area;
        const w2 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area;
        const w0 = 1 - w1 - w2;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const k = y * size + x;
        // Only a texel strictly inside counts as a claim: two triangles sharing an edge both touch it.
        if (w0 > 1e-4 && w1 > 1e-4 && w2 > 1e-4 && claims[k]! < 255) claims[k] = claims[k]! + 1;
        if (coverage[k]) continue;
        coverage[k] = 1;
        tri[k] = i;
        bary[k * 2] = w1;
        bary[k * 2 + 1] = w2;
      }
    }
  }
  let covered = 0;
  let doubled = 0;
  for (let k = 0; k < texels; k += 1) {
    if (coverage[k]) covered += 1;
    if (claims[k]! > 1) doubled += 1;
  }
  if (!covered) throw new BakeError("The UVs cover no texels — they may be outside the 0–1 square.");

  const at = (k: number, data: Float32Array, stride: number, out: number[]) => {
    const i = tri[k]!;
    const u = bary[k * 2]!, v = bary[k * 2 + 1]!, w = 1 - u - v;
    for (let s = 0; s < stride; s += 1) out[s] = data[i * 9 + s]! * w + data[i * 9 + 3 + s]! * u + data[i * 9 + 6 + s]! * v;
  };

  // 2. Geometry maps: position, height, up, edges, cavity, tangent frame.
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < tris.pos.length; i += 3) {
    lo = Math.min(lo, tris.pos[i]!);
    hi = Math.max(hi, tris.pos[i]!);
  }
  let extent = 0;
  {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.pos.length; i += 1) {
      const k = i % 3;
      mn[k] = Math.min(mn[k]!, tris.pos[i]!);
      mx[k] = Math.max(mx[k]!, tris.pos[i]!);
    }
    extent = Math.hypot(mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!) || 1;
  }
  const position = new Float32Array(texels * 3);
  const height = new Float32Array(texels);
  const up = new Float32Array(texels);
  const edgeMap = new Float32Array(texels);
  const cavity = new Float32Array(texels);
  const normalAt = new Float32Array(texels * 3);
  const tangents = new Float32Array(texels * 6);
  // Per triangle: the surface's direction of increasing U and V.
  const triTangent = new Float32Array(tris.count * 6);
  for (let i = 0; i < tris.count; i += 1) {
    const P = tris.pos, U = tris.uv;
    const e1 = [P[i * 9 + 3]! - P[i * 9]!, P[i * 9 + 4]! - P[i * 9 + 1]!, P[i * 9 + 5]! - P[i * 9 + 2]!];
    const e2 = [P[i * 9 + 6]! - P[i * 9]!, P[i * 9 + 7]! - P[i * 9 + 1]!, P[i * 9 + 8]! - P[i * 9 + 2]!];
    const du1 = U[i * 6 + 2]! - U[i * 6]!, dv1 = U[i * 6 + 3]! - U[i * 6 + 1]!;
    const du2 = U[i * 6 + 4]! - U[i * 6]!, dv2 = U[i * 6 + 5]! - U[i * 6 + 1]!;
    const r = du1 * dv2 - du2 * dv1;
    const f = Math.abs(r) > 1e-14 ? 1 / r : 0;
    for (let k = 0; k < 3; k += 1) {
      triTangent[i * 6 + k] = (e1[k]! * dv2 - e2[k]! * dv1) * f;
      triTangent[i * 6 + 3 + k] = (e2[k]! * du1 - e1[k]! * du2) * f;
    }
  }
  const tmp = [0, 0, 0];
  let clock = performance.now();
  for (let k = 0; k < texels; k += 1) {
    if (!coverage[k]) continue;
    at(k, tris.pos, 3, tmp);
    const q: V3 = [tmp[0]!, tmp[1]!, tmp[2]!];
    position.set(q, k * 3);
    height[k] = hi > lo ? (q[1] - lo) / (hi - lo) : 0.5;
    at(k, tris.nrm, 3, tmp);
    const n = norm([tmp[0]!, tmp[1]!, tmp[2]!]);
    normalAt.set(n, k * 3);
    up[k] = Math.max(0, n[1]);
    let e = 0, c = 0;
    for (const edge of edges[tris.face[tri[k]!]!]!) {
      if (!edge.convex && !edge.concave) continue;
      const d = segmentDistance(q, edge.a, edge.b);
      const f = 1 - smooth01(d / Math.max(1e-6, opts.edgeWidth));
      e = Math.max(e, f * edge.convex);
      c = Math.max(c, f * edge.concave);
    }
    edgeMap[k] = e;
    cavity[k] = c;
    // Gram–Schmidt the triangle's U and V directions against the shading normal.
    const i = tri[k]!;
    const T: V3 = [triTangent[i * 6]!, triTangent[i * 6 + 1]!, triTangent[i * 6 + 2]!];
    const tn = norm(sub(T, [n[0] * dot(n, T), n[1] * dot(n, T), n[2] * dot(n, T)]));
    const B0: V3 = [triTangent[i * 6 + 3]!, triTangent[i * 6 + 4]!, triTangent[i * 6 + 5]!];
    const cross: V3 = [n[1] * tn[2] - n[2] * tn[1], n[2] * tn[0] - n[0] * tn[2], n[0] * tn[1] - n[1] * tn[0]];
    const handed = dot(cross, B0) < 0 ? -1 : 1;
    tangents.set([...tn, cross[0] * handed, cross[1] * handed, cross[2] * handed], k * 6);
    if (performance.now() - clock > 30) {
      onProgress?.("Measuring the surface", k / texels);
      await yieldNow();
      clock = performance.now();
    }
  }

  // 3. Ambient occlusion, traced at a capped resolution and filtered up.
  const ao = new Float32Array(texels).fill(1);
  const bvh = new Bvh(tris);
  if (opts.aoSamples > 0) {
    const aoSize = Math.min(size, opts.aoMaxSize ?? Math.max(128, Math.min(512, size >> 2)));
    const step = size / aoSize;
    const dirs = hemisphere(opts.aoSamples);
    const reach = Math.max(1e-4, opts.aoDistance * extent);
    const small = new Float32Array(aoSize * aoSize).fill(-1);
    for (let y = 0; y < aoSize; y += 1) {
      for (let x = 0; x < aoSize; x += 1) {
        const k = Math.min(size - 1, Math.floor((y + 0.5) * step)) * size + Math.min(size - 1, Math.floor((x + 0.5) * step));
        if (!coverage[k]) continue;
        const q: V3 = [position[k * 3]!, position[k * 3 + 1]!, position[k * 3 + 2]!];
        const n: V3 = [normalAt[k * 3]!, normalAt[k * 3 + 1]!, normalAt[k * 3 + 2]!];
        const [t, b] = basis(n);
        const o: V3 = [q[0] + n[0] * extent * 1e-4, q[1] + n[1] * extent * 1e-4, q[2] + n[2] * extent * 1e-4];
        let blocked = 0;
        // Each texel turns the pattern by its own angle, so neighbours do not share their gaps.
        const turn = ((x * 7 + y * 13) % 17) / 17 * Math.PI * 2;
        const cs = Math.cos(turn), sn = Math.sin(turn);
        for (const d of dirs) {
          const dx = d[0] * cs - d[1] * sn, dy = d[0] * sn + d[1] * cs;
          const dir: V3 = [t[0] * dx + b[0] * dy + n[0] * d[2], t[1] * dx + b[1] * dy + n[1] * d[2], t[2] * dx + b[2] * dy + n[2] * d[2]];
          if (bvh.cast(o, dir, reach, true)) blocked += 1;
        }
        small[y * aoSize + x] = 1 - blocked / dirs.length;
      }
      if (performance.now() - clock > 30) {
        onProgress?.("Tracing ambient occlusion", y / aoSize);
        await yieldNow();
        clock = performance.now();
      }
    }
    padInPlace(small, aoSize, 4);
    for (let k = 0; k < texels; k += 1) {
      if (!coverage[k]) continue;
      const x = ((k % size) + 0.5) / step - 0.5;
      const y = (Math.floor(k / size) + 0.5) / step - 0.5;
      ao[k] = bilinear(small, aoSize, x, y);
    }
  }

  // 4. Normals from a high-poly surface, cast along the low one's normal from just outside it.
  const normal = new Float32Array(texels * 3);
  for (let k = 0; k < texels; k += 1) normal[k * 3 + 2] = 1;
  if (opts.high) {
    const highTris = trianglesOf(withModifiers(evaluate(opts.high).poly, []));
    const highBvh = new Bvh(highTris);
    const reach = Math.max(1e-4, (opts.cageDistance ?? 0.05) * extent);
    for (let k = 0; k < texels; k += 1) {
      if (!coverage[k]) continue;
      const n: V3 = [normalAt[k * 3]!, normalAt[k * 3 + 1]!, normalAt[k * 3 + 2]!];
      const o: V3 = [position[k * 3]! + n[0] * reach, position[k * 3 + 1]! + n[1] * reach, position[k * 3 + 2]! + n[2] * reach];
      const hit = highBvh.cast(o, [-n[0], -n[1], -n[2]], reach * 2);
      if (hit) {
        const h = highBvh.normalAt(hit);
        const T: V3 = [tangents[k * 6]!, tangents[k * 6 + 1]!, tangents[k * 6 + 2]!];
        const B: V3 = [tangents[k * 6 + 3]!, tangents[k * 6 + 4]!, tangents[k * 6 + 5]!];
        const local = norm([dot(h, T), dot(h, B), dot(h, n)]);
        normal.set(local[2] > 0 ? local : [0, 0, 1], k * 3);
      }
      if ((k & 4095) === 0 && performance.now() - clock > 30) {
        onProgress?.("Baking normals", k / texels);
        await yieldNow();
        clock = performance.now();
      }
    }
  }

  // 5. Pad every map past its islands: each empty texel near one copies its nearest covered texel.
  const source = nearestCovered(coverage, size, 8);
  for (const [data, stride] of [[edgeMap, 1], [cavity, 1], [height, 1], [up, 1], [position, 3], [normal, 3], [tangents, 6], [ao, 1]] as const) {
    for (let k = 0; k < texels; k += 1) {
      const from = source[k]!;
      if (from < 0 || from === k) continue;
      for (let c = 0; c < stride; c += 1) data[k * stride + c] = data[from * stride + c]!;
    }
  }
  let area3 = 0;
  let areaUv = 0;
  for (let i = 0; i < tris.count; i += 1) {
    const P = tris.pos, U = tris.uv;
    const e1 = [P[i * 9 + 3]! - P[i * 9]!, P[i * 9 + 4]! - P[i * 9 + 1]!, P[i * 9 + 5]! - P[i * 9 + 2]!];
    const e2 = [P[i * 9 + 6]! - P[i * 9]!, P[i * 9 + 7]! - P[i * 9 + 1]!, P[i * 9 + 8]! - P[i * 9 + 2]!];
    area3 += Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!) / 2;
    areaUv += Math.abs((U[i * 6 + 2]! - U[i * 6]!) * (U[i * 6 + 5]! - U[i * 6 + 1]!) - (U[i * 6 + 4]! - U[i * 6]!) * (U[i * 6 + 3]! - U[i * 6 + 1]!)) / 2;
  }
  onProgress?.("Done", 1);
  return {
    size,
    coverage,
    overlap: doubled / covered,
    ao,
    edges: edgeMap,
    cavity,
    height,
    up,
    position,
    normal,
    tangents,
    metresPerUv: areaUv > 0 ? Math.sqrt(area3 / areaUv) : 1,
  };
}

function bilinear(src: Float32Array, size: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(y)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const g = (xx: number, yy: number) => {
    const v = src[yy * size + xx]!;
    return v < 0 ? src[y0 * size + x0]! : v;
  };
  return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
}

/**
 * For each texel: itself if covered, else the covered texel it grows from
 * within `passes` steps (8-connected), else -1.
 */
function nearestCovered(covered: ArrayLike<number>, size: number, passes: number): Int32Array {
  const from = new Int32Array(size * size);
  let frontier: number[] = [];
  for (let k = 0; k < size * size; k += 1) {
    from[k] = covered[k] ? k : -1;
    if (covered[k]) frontier.push(k);
  }
  for (let pass = 0; pass < passes && frontier.length; pass += 1) {
    const next: number[] = [];
    for (const k of frontier) {
      const x = k % size;
      const y = (k - x) / size;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          const j = yy * size + xx;
          if (from[j] !== -1) continue;
          from[j] = from[k]!;
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return from;
}

/** Pad a one-channel map whose empty texels are negative, `passes` texels outward. */
function padInPlace(data: Float32Array, size: number, passes: number): void {
  const source = nearestCovered(data.map((v) => (v < 0 ? 0 : 1)), size, passes);
  for (let k = 0; k < data.length; k += 1) if (source[k]! >= 0 && source[k] !== k) data[k] = data[source[k]!]!;
}
