import * as THREE from "three";
import { primitiveGeometry, shapeFromGeometry, type MeshShape } from "./geometry";
import { evaluate } from "./modifiers";
import {
  compactPoly,
  dirKey,
  dot,
  edgeKey,
  faceNormal,
  len,
  sub,
  topology,
  unionFind,
  withPositions,
  type Poly,
  type V3,
} from "./poly";

/**
 * Between the cage and what is drawn.
 *
 * `shapeFromPoly` evaluates the modifier stack, triangulates every face and
 * splits vertices where the surface is not smooth — along a sharp edge, or a
 * UV seam — giving the triangle mesh three.js draws and the exporters write.
 * `polyOf` goes the other way, for a mesh that arrived as triangles: it welds
 * by position, pairs triangles back into quads and marks hard edges by angle.
 */

/** Edges between faces meeting at more than this are hard when a triangle mesh becomes a cage. */
export const AUTO_SHARP_DEGREES = 40;

/**
 * Edges between faces meeting at more than this always draw hard, marked or
 * not — the walls an inset or extrude makes would otherwise shade as if
 * melted. Marking an edge sharp makes a softer one hard too.
 */
export const AUTO_HARD_DEGREES = 60;
const AUTO_HARD_COS = Math.cos((AUTO_HARD_DEGREES * Math.PI) / 180);

// ── triangulation ───────────────────────────────────────────────────────────

/** Triangles for one face, as corner indices into it, wound like the face. */
export function triangulateFace(p: Poly, face: number[]): number[] {
  const n = face.length;
  if (n === 3) return [0, 1, 2];
  const pos = (c: number): V3 => {
    const v = face[c]!;
    return [p.positions[v * 3]!, p.positions[v * 3 + 1]!, p.positions[v * 3 + 2]!];
  };
  const normal = faceNormal(p, face);
  const facing = (a: number, b: number, c: number) => {
    const pa = pos(a);
    const u = sub(pos(b), pa);
    const w = sub(pos(c), pa);
    return dot([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], normal);
  };
  if (n === 4) {
    // Split along the shorter diagonal, unless that folds a concave quad.
    const d02 = len(sub(pos(0), pos(2)));
    const d13 = len(sub(pos(1), pos(3)));
    const ok02 = facing(0, 1, 2) >= 0 && facing(0, 2, 3) >= 0;
    const ok13 = facing(0, 1, 3) >= 0 && facing(1, 2, 3) >= 0;
    if (ok02 && (!ok13 || d02 <= d13)) return [0, 1, 2, 0, 2, 3];
    return [0, 1, 3, 1, 2, 3];
  }
  // An n-gon: project onto its dominant plane and ear-clip.
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  const [i, j] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [2, 0] : [0, 1];
  const contour = face.map((_, c) => {
    const v = pos(c);
    return new THREE.Vector2(v[i], v[j]);
  });
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  if (tris.length !== n - 2) {
    const fan: number[] = [];
    for (let c = 1; c < n - 1; c += 1) fan.push(0, c, c + 1);
    return fan;
  }
  const out: number[] = [];
  for (const [a, b, c] of tris) {
    if (facing(a!, b!, c!) >= 0) out.push(a!, b!, c!);
    else out.push(a!, c!, b!);
  }
  return out;
}

const cageTriCache = new WeakMap<Poly, { indices: Uint32Array; triFace: Uint32Array }>();

/** The cage itself as triangles over its own vertices, with each triangle's face: what edit mode picks against. */
export function cageTriangles(p: Poly): { indices: Uint32Array; triFace: Uint32Array } {
  const hit = cageTriCache.get(p);
  if (hit) return hit;
  const indices: number[] = [];
  const triFace: number[] = [];
  p.faces.forEach((face, f) => {
    const tris = triangulateFace(p, face);
    for (let k = 0; k < tris.length; k += 3) {
      indices.push(face[tris[k]!]!, face[tris[k + 1]!]!, face[tris[k + 2]!]!);
      triFace.push(f);
    }
  });
  const out = { indices: Uint32Array.from(indices), triFace: Uint32Array.from(triFace) };
  cageTriCache.set(p, out);
  return out;
}

// ── cage → triangles ────────────────────────────────────────────────────────

interface RenderInfo {
  /** Render vertex → cage vertex; set when no modifier changed the topology, for fast drags. */
  vertexOf: Int32Array | null;
  /** Modifiers that had to be skipped as too heavy. */
  skipped: string[];
}

const renderInfo = new WeakMap<MeshShape, RenderInfo>();

/** Modifiers the last evaluation of this shape skipped as too heavy. */
export function skippedModifiers(shape: MeshShape): string[] {
  return renderInfo.get(shape)?.skipped ?? [];
}

/** The drawable triangle mesh for a cage, with the cage attached. */
export function shapeFromPoly(cage: Poly): MeshShape {
  const active = cage.modifiers.some((m) => m.on);
  const { poly: p, skipped } = active ? evaluate(cage) : { poly: cage, skipped: [] };
  const t = topology(p);
  const starts = new Int32Array(p.faces.length + 1);
  p.faces.forEach((f, i) => (starts[i + 1] = starts[i]! + f.length));
  const corners = starts[p.faces.length]!;
  // Corners around a vertex that are joined by smooth edges share a normal.
  const groups = unionFind(corners);
  const normals = p.faces.map((f) => faceNormal(p, f));
  p.faces.forEach((face, f) => {
    const n = face.length;
    for (let c = 0; c < n; c += 1) {
      const a = face[c]!;
      const b = face[(c + 1) % n]!;
      const key = edgeKey(a, b);
      if (p.sharp.has(key) || t.edgeFaces.get(key)!.length !== 2) continue;
      const other = t.directed.get(dirKey(b, a));
      if (!other) continue;
      const [g, k] = other;
      if (dot(normals[f]!, normals[g]!) < AUTO_HARD_COS) continue;
      const m = p.faces[g]!.length;
      groups.union(starts[f]! + c, starts[g]! + ((k + 1) % m));
      groups.union(starts[f]! + ((c + 1) % n), starts[g]! + k);
    }
  });
  const index = new Map<string | number, number>();
  const vertexOf: number[] = [];
  const uvOut: number[] = [];
  const cornerVertex = new Int32Array(corners);
  p.faces.forEach((face, f) => {
    const uv = p.uvs?.[f];
    for (let c = 0; c < face.length; c += 1) {
      const id = starts[f]! + c;
      const root = groups.find(id);
      const key = uv ? `${root}:${uv[c * 2]}:${uv[c * 2 + 1]}` : root;
      let r = index.get(key);
      if (r === undefined) {
        r = vertexOf.length;
        index.set(key, r);
        vertexOf.push(face[c]!);
        if (uv) uvOut.push(uv[c * 2]!, uv[c * 2 + 1]!);
      }
      cornerVertex[id] = r;
    }
  });
  const indices: number[] = [];
  p.faces.forEach((face, f) => {
    const tris = triangulateFace(p, face);
    for (const c of tris) indices.push(cornerVertex[starts[f]! + c]!);
  });
  const positions = new Float32Array(vertexOf.length * 3);
  vertexOf.forEach((v, i) => {
    positions[i * 3] = p.positions[v * 3]!;
    positions[i * 3 + 1] = p.positions[v * 3 + 1]!;
    positions[i * 3 + 2] = p.positions[v * 3 + 2]!;
  });
  const shape: MeshShape = { positions, indices: Uint32Array.from(indices), poly: cage };
  if (p.uvs) shape.uvs = Float32Array.from(uvOut);
  renderInfo.set(shape, { vertexOf: active ? null : Int32Array.from(vertexOf), skipped });
  return shape;
}

/**
 * The shape with the cage's vertices at new positions and nothing else
 * changed — every frame of a drag. Reuses the triangulation when it can.
 */
export function movedShape(shape: MeshShape, positions: number[]): MeshShape {
  const cage = withPositions(shape.poly!, positions);
  const info = renderInfo.get(shape);
  if (!info?.vertexOf) return shapeFromPoly(cage);
  const out = new Float32Array(info.vertexOf.length * 3);
  info.vertexOf.forEach((v, i) => {
    out[i * 3] = positions[v * 3]!;
    out[i * 3 + 1] = positions[v * 3 + 1]!;
    out[i * 3 + 2] = positions[v * 3 + 2]!;
  });
  const next: MeshShape = { positions: out, indices: shape.indices, poly: cage };
  if (shape.uvs) next.uvs = shape.uvs;
  renderInfo.set(next, info);
  return next;
}

/** A primitive's cage: quads where it has them, n-gon caps, its own UVs and hard edges. */
export function primitivePoly(kind: string, segments: number): Poly | null {
  const g = primitiveGeometry(kind, segments);
  if (!g) return null;
  const shape = shapeFromGeometry(g, undefined, true);
  g.dispose();
  return polyFromTriangles(shape);
}

// ── triangles → cage ────────────────────────────────────────────────────────

const liftCache = new WeakMap<MeshShape, Poly>();

/** The cage of a mesh: its own, or one recovered from its triangles (the same one every time). */
export function polyOf(shape: MeshShape): Poly {
  if (shape.poly) return shape.poly;
  let p = liftCache.get(shape);
  if (!p) {
    p = polyFromTriangles(shape);
    liftCache.set(shape, p);
  }
  return p;
}

/** A shape guaranteed to carry its cage. */
export function withCage(shape: MeshShape): MeshShape {
  return shape.poly ? shape : shapeFromPoly(polyOf(shape));
}

const sameUv = (a: number[] | undefined, i: number, b: number[] | undefined, j: number) =>
  !a || !b || (Math.abs(a[i * 2]! - b[j * 2]!) < 1e-6 && Math.abs(a[i * 2 + 1]! - b[j * 2 + 1]!) < 1e-6);

/**
 * Weld a triangle mesh by position, pair consecutive triangles back into the
 * quads they came from, merge flat triangle fans (a cylinder's cap) into one
 * n-gon, and mark edges sharper than `sharpDegrees` hard.
 *
 * Pairing only consecutive triangles is deliberate: every generator and most
 * exporters emit a quad as two triangles in a row, and looking no further
 * never invents quads across a model's real triangle topology.
 */
export function polyFromTriangles(shape: MeshShape, sharpDegrees = AUTO_SHARP_DEGREES): Poly {
  const src = shape.positions;
  const n = src.length / 3;
  const weld = new Int32Array(n);
  const seen = new Map<string, number>();
  const positions: number[] = [];
  for (let i = 0; i < n; i += 1) {
    // Quantised, so a seam whose two sides differ by rounding (sin 2π ≠ 0) still welds.
    const q = (x: number) => Math.round(x * 1e5);
    const key = `${q(src[i * 3]!)},${q(src[i * 3 + 1]!)},${q(src[i * 3 + 2]!)}`;
    let j = seen.get(key);
    if (j === undefined) {
      j = positions.length / 3;
      seen.set(key, j);
      positions.push(src[i * 3]!, src[i * 3 + 1]!, src[i * 3 + 2]!);
    }
    weld[i] = j;
  }
  const tris: { v: number[]; uv: number[] | undefined }[] = [];
  for (let t = 0; t < shape.indices.length; t += 3) {
    const r = [shape.indices[t]!, shape.indices[t + 1]!, shape.indices[t + 2]!];
    const v = r.map((i) => weld[i]!);
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    const uv = shape.uvs ? r.flatMap((i) => [shape.uvs![i * 2]!, shape.uvs![i * 2 + 1]!]) : undefined;
    tris.push({ v, uv });
  }
  const base: Poly = { positions, faces: [], uvs: shape.uvs ? [] : null, sharp: new Set(), modifiers: [] };
  const vec = (i: number): V3 => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
  const cosLimit = Math.cos((sharpDegrees * Math.PI) / 180);

  const faces: number[][] = [];
  const uvs: number[][] = [];
  const pushFace = (v: number[], uv: number[] | undefined) => {
    faces.push(v);
    if (base.uvs) uvs.push(uv ?? new Array(v.length * 2).fill(0));
  };
  const uses = new Int32Array(positions.length / 3);
  for (const tri of tris) for (const v of tri.v) uses[v]! += 1;
  // How many triangles from `t` on in a row hold `v`, each sharing an edge
  // through `v` with the one before it — a fan around `v`.
  const run = (t: number, v: number) => {
    if (!tris[t]!.v.includes(v)) return 0;
    let k = t + 1;
    while (k < tris.length && tris[k]!.v.includes(v) && tris[k]!.v.filter((x) => x !== v && tris[k - 1]!.v.includes(x)).length) k += 1;
    return k - t;
  };
  let t = 0;
  outer: while (t < tris.length) {
    const a = tris[t]!;
    // A run of triangles that is every triangle around one vertex, all in one
    // plane, is a fan (a cylinder's cap): one n-gon.
    for (const c of a.v) {
      const k = run(t, c);
      if (k >= 3 && k === uses[c]) {
        const ngon = fanToFace(tris.slice(t, t + k), c, vec);
        if (ngon) {
          pushFace(ngon.v, ngon.uv);
          t += k;
          continue outer;
        }
      }
    }
    const b = tris[t + 1];
    // Two triangles of a longer fan share a spoke, not a diagonal.
    const fan = a.v.some((v) => run(t, v) >= 4);
    const quad = b && !fan ? pairToQuad(a, b, vec, cosLimit) : null;
    if (quad) {
      pushFace(quad.v, quad.uv);
      t += 2;
    } else {
      pushFace(a.v, a.uv);
      t += 1;
    }
  }
  let p: Poly = { ...base, faces, uvs: base.uvs ? uvs : null };
  p = compactPoly(p).poly;
  return { ...p, sharp: sharpByAngle(p, sharpDegrees) };
}

function pairToQuad(
  a: { v: number[]; uv: number[] | undefined },
  b: { v: number[]; uv: number[] | undefined },
  vec: (i: number) => V3,
  cosLimit: number,
): { v: number[]; uv: number[] | undefined } | null {
  for (let i = 0; i < 3; i += 1) {
    const x = a.v[i]!;
    const y = a.v[(i + 1) % 3]!;
    const p = a.v[(i + 2) % 3]!;
    for (let j = 0; j < 3; j += 1) {
      if (b.v[j] !== y || b.v[(j + 1) % 3] !== x) continue;
      const q = b.v[(j + 2) % 3]!;
      if (q === p) return null;
      // The UVs must agree along the shared edge, or the diagonal is a seam.
      if (!sameUv(a.uv, i, b.uv, (j + 1) % 3) || !sameUv(a.uv, (i + 1) % 3, b.uv, j)) return null;
      const quad = [x, q, y, p];
      const pts = quad.map(vec);
      const n1 = triNormal(vec(x), vec(y), vec(p));
      const n2 = triNormal(vec(y), vec(x), vec(q));
      if (dot(n1, n2) < cosLimit) return null;
      // A fan around one vertex has a short second diagonal; a real quad's are alike.
      const d1 = len(sub(pts[0]!, pts[2]!));
      const d2 = len(sub(pts[1]!, pts[3]!));
      if (Math.min(d1, d2) < 0.55 * Math.max(d1, d2)) return null;
      const normal: V3 = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]];
      for (let k = 0; k < 4; k += 1) {
        const prev = pts[(k + 3) % 4]!;
        const cur = pts[k]!;
        const next = pts[(k + 1) % 4]!;
        if (dot(triNormal(prev, cur, next), normal) <= 1e-9) return null; // not convex
      }
      const uv =
        a.uv && b.uv
          ? [a.uv[i * 2]!, a.uv[i * 2 + 1]!, b.uv[((j + 2) % 3) * 2]!, b.uv[((j + 2) % 3) * 2 + 1]!, a.uv[((i + 1) % 3) * 2]!, a.uv[((i + 1) % 3) * 2 + 1]!, a.uv[((i + 2) % 3) * 2]!, a.uv[((i + 2) % 3) * 2 + 1]!]
          : undefined;
      return { v: quad, uv };
    }
  }
  return null;
}

function triNormal(a: V3, b: V3, c: V3): V3 {
  const u = sub(b, a);
  const w = sub(c, a);
  const n: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = len(n);
  return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : n;
}

/** The outer loop of a closed fan of coplanar triangles around `c`, or null if it is not one. */
function fanToFace(
  fan: { v: number[]; uv: number[] | undefined }[],
  c: number,
  vec: (i: number) => V3,
): { v: number[]; uv: number[] | undefined } | null {
  const normals = fan.map((tri) => triNormal(vec(tri.v[0]!), vec(tri.v[1]!), vec(tri.v[2]!)));
  if (normals.some((n) => dot(n, normals[0]!) < 0.9999)) return null;
  // Each triangle (c, a, b) contributes the outer edge a→b.
  const byStart = new Map<number, { to: number; uv: number[] | null }>();
  for (const tri of fan) {
    const k = tri.v.indexOf(c);
    const a = tri.v[(k + 1) % 3]!;
    const b = tri.v[(k + 2) % 3]!;
    if (byStart.has(a)) return null;
    byStart.set(a, { to: b, uv: tri.uv ? [tri.uv[((k + 1) % 3) * 2]!, tri.uv[((k + 1) % 3) * 2 + 1]!] : null });
  }
  const start = fan[0]!.v[(fan[0]!.v.indexOf(c) + 1) % 3]!;
  const ring: number[] = [];
  const uv: number[] = [];
  let v = start;
  do {
    const step = byStart.get(v);
    if (!step) return null;
    ring.push(v);
    if (step.uv) uv.push(...step.uv);
    v = step.to;
  } while (v !== start && ring.length <= fan.length);
  if (v !== start || ring.length !== fan.length) return null;
  return { v: ring, uv: fan[0]!.uv ? uv : undefined };
}

/** Every edge whose two faces meet at more than `degrees`. */
export function sharpByAngle(p: Poly, degrees: number): Set<number> {
  const t = topology(p);
  const normals = p.faces.map((f) => faceNormal(p, f));
  const limit = Math.cos((degrees * Math.PI) / 180);
  const out = new Set<number>();
  for (const [key, faces] of t.edgeFaces) {
    if (faces.length === 2 && dot(normals[faces[0]!]!, normals[faces[1]!]!) < limit) out.add(key);
  }
  return out;
}
