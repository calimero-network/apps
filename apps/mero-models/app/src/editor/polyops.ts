import { mirrorPoly } from "./modifiers";
import {
  Build,
  add,
  at,
  compactPoly,
  cornerUv,
  cross,
  dirKey,
  dot,
  edgeEnds,
  edgeKey,
  faceNormal,
  faceNormalRaw,
  len,
  lerp3,
  norm,
  remapMarks,
  scale,
  sub,
  topology,
  unionFind,
  vertexTotal,
  type Axis,
  type Poly,
  type V3,
} from "./poly";

/**
 * The modelling tools, each a pure function from a cage (and a selection) to
 * a new cage and the selection that should follow — what Blender does on E,
 * I, Ctrl+B, Ctrl+R and friends.
 *
 * A tool that cannot do anything with the selection it is given throws a
 * `MeshOpError` saying what it needs; the editor shows that message.
 */
export class MeshOpError extends Error {}

export interface OpResult {
  poly: Poly;
  /** The vertices to select afterwards. */
  verts?: Set<number>;
  /** The faces to select afterwards. */
  faces?: Set<number>;
}

type Uv = [number, number] | null;

const lerpUv = (a: Uv, b: Uv, t: number): Uv => (a && b ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : null);
const flatUv = (list: Uv[], keep: boolean): number[] | null => (keep ? list.flatMap((u) => u ?? [0, 0]) : null);

/** The UV that `pos` would have inside face `f`, from the corner `c` it moved away from. */
function uvInFace(p: Poly, f: number, c: number, pos: V3): Uv {
  const face = p.faces[f]!;
  const n = face.length;
  const uc = cornerUv(p, f, c);
  if (!uc) return null;
  const pv = at(p, face[c]!);
  const e1 = sub(at(p, face[(c + 1) % n]!), pv);
  const e2 = sub(at(p, face[(c - 1 + n) % n]!), pv);
  const off = sub(pos, pv);
  const a11 = dot(e1, e1), a12 = dot(e1, e2), a22 = dot(e2, e2);
  const b1 = dot(e1, off), b2 = dot(e2, off);
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-18) return uc;
  const alpha = (b1 * a22 - b2 * a12) / det;
  const beta = (a11 * b2 - a12 * b1) / det;
  const un = cornerUv(p, f, c + 1)!;
  const up = cornerUv(p, f, c - 1)!;
  return [uc[0] + alpha * (un[0] - uc[0]) + beta * (up[0] - uc[0]), uc[1] + alpha * (un[1] - uc[1]) + beta * (up[1] - uc[1])];
}

/** Some UV the vertex has, for faces that have no better source. */
function anyUv(p: Poly, v: number): Uv {
  if (!p.uvs) return null;
  for (const f of topology(p).vertexFaces[v] ?? []) return cornerUv(p, f, p.faces[f]!.indexOf(v));
  return [0, 0];
}

function newellOf(positions: number[], verts: number[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < verts.length; i += 1) {
    const c = verts[i]! * 3;
    const n = verts[(i + 1) % verts.length]! * 3;
    x += (positions[c + 1]! - positions[n + 1]!) * (positions[c + 2]! + positions[n + 2]!);
    y += (positions[c + 2]! - positions[n + 2]!) * (positions[c]! + positions[n]!);
    z += (positions[c]! - positions[n]!) * (positions[c + 1]! + positions[n + 1]!);
  }
  return [x, y, z];
}

function finish(b: Build, p: Poly, verts?: Set<number>, faces?: Set<number>): OpResult {
  const { poly, remap } = compactPoly(b.done(p.modifiers));
  const out: OpResult = { poly };
  if (verts) out.verts = new Set([...verts].map((v) => remap[v]!).filter((v) => v >= 0));
  if (faces) out.faces = faces;
  return out;
}

// ── selecting by topology ───────────────────────────────────────────────────

/**
 * The edge loop through a–b (Alt+click): onward through every vertex with
 * four edges, taking the edge that shares no face with the one it came from.
 * Along an open border it follows the border instead.
 */
export function edgeLoop(p: Poly, a: number, b: number): number[] {
  const t = topology(p);
  if (!t.edgeFaces.has(edgeKey(a, b))) return [];
  const out = new Set([edgeKey(a, b)]);
  const step = (prev: number, cur: number): number => {
    const nb = t.neighbours[cur]!;
    const faces = t.edgeFaces.get(edgeKey(prev, cur))!;
    if (faces.length === 1) {
      const onBorder = nb.filter((w) => w !== prev && t.edgeFaces.get(edgeKey(cur, w))!.length === 1);
      return onBorder.length === 1 ? onBorder[0]! : -1;
    }
    if (nb.length !== 4 || faces.length !== 2) return -1;
    const exclude = new Set([prev]);
    for (const f of faces) {
      const face = p.faces[f]!;
      const c = face.indexOf(cur);
      exclude.add(face[(c + 1) % face.length]!).add(face[(c - 1 + face.length) % face.length]!);
    }
    const rest = nb.filter((w) => !exclude.has(w));
    return rest.length === 1 ? rest[0]! : -1;
  };
  for (const [s0, s1] of [[a, b], [b, a]] as const) {
    let prev = s0;
    let cur = s1;
    for (let guard = 0; guard < t.edgeFaces.size; guard += 1) {
      const next = step(prev, cur);
      if (next < 0) break;
      const key = edgeKey(cur, next);
      if (out.has(key)) break;
      out.add(key);
      prev = cur;
      cur = next;
    }
  }
  return [...out];
}

/** The edge ring through a–b (Ctrl+Alt+click): across quads to the opposite edge, both ways. Also the faces it crosses — a face loop. */
export function edgeRing(p: Poly, a: number, b: number): { edges: number[]; faces: Set<number> } {
  const t = topology(p);
  const start = edgeKey(a, b);
  const startFaces = t.edgeFaces.get(start);
  const edges = new Set<number>();
  const faces = new Set<number>();
  if (!startFaces) return { edges: [], faces };
  edges.add(start);
  for (const f0 of startFaces) {
    let key = start;
    let f = f0;
    for (let guard = 0; guard <= p.faces.length; guard += 1) {
      const face = p.faces[f]!;
      if (faces.has(f) || face.length !== 4) break;
      faces.add(f);
      let c = 0;
      while (c < 4 && edgeKey(face[c]!, face[(c + 1) % 4]!) !== key) c += 1;
      const opposite = edgeKey(face[(c + 2) % 4]!, face[(c + 3) % 4]!);
      edges.add(opposite);
      const onward = t.edgeFaces.get(opposite)!.filter((g) => g !== f);
      if (onward.length !== 1) break;
      key = opposite;
      f = onward[0]!;
    }
  }
  return { edges: [...edges], faces };
}

/** Everything connected to the selection (Ctrl+L). */
export function linked(p: Poly, verts: Set<number>): Set<number> {
  const t = topology(p);
  const out = new Set(verts);
  const queue = [...verts];
  while (queue.length) {
    const v = queue.pop()!;
    for (const u of t.neighbours[v] ?? []) {
      if (!out.has(u)) {
        out.add(u);
        queue.push(u);
      }
    }
  }
  return out;
}

// ── loop cut ────────────────────────────────────────────────────────────────

/**
 * Ctrl+R: `cuts` evenly spaced edge loops across the ring of quads through
 * a–b. Faces at the ends of an open ring get the new vertices on their edge,
 * so the surface stays closed.
 */
export function loopCut(p: Poly, a: number, b: number, cuts = 1): OpResult {
  const ring = edgeRing(p, a, b);
  if (!ring.faces.size) throw new MeshOpError("Loop cut needs an edge between quads — select one edge across the ring to cut.");
  const k = Math.max(1, Math.min(32, Math.round(cuts)));
  const bld = new Build(p);
  const cutsOf = new Map<number, number[]>();
  const fresh = new Set<number>();
  for (const key of ring.edges) {
    const [x, y] = edgeEnds(key);
    const list: number[] = [];
    for (let i = 1; i <= k; i += 1) list.push(bld.vert(lerp3(at(p, x), at(p, y), i / (k + 1))));
    list.forEach((v) => fresh.add(v));
    cutsOf.set(key, list);
    for (const [marks, out] of [[p.sharp, bld.sharp], [p.seams, bld.seams]] as const) {
      if (!marks.has(key)) continue;
      const chain = [x, ...list, y];
      for (let i = 0; i + 1 < chain.length; i += 1) out.add(edgeKey(chain[i]!, chain[i + 1]!));
    }
  }
  const pts = (from: number, to: number): number[] => {
    const list = cutsOf.get(edgeKey(from, to))!;
    return from < to ? list : [...list].reverse();
  };
  const keepUv = !!p.uvs;
  p.faces.forEach((face, f) => {
    const n = face.length;
    if (ring.faces.has(f)) {
      let c = 0;
      while (c < 4 && !(cutsOf.has(edgeKey(face[c]!, face[(c + 1) % 4]!)) && cutsOf.has(edgeKey(face[(c + 2) % 4]!, face[(c + 3) % 4]!)))) c += 1;
      const A = face[c]!, B = face[(c + 1) % 4]!, C = face[(c + 2) % 4]!, D = face[(c + 3) % 4]!;
      const left = [A, ...pts(A, B), B];
      const right = [D, ...pts(D, C), C];
      const uA = cornerUv(p, f, c), uB = cornerUv(p, f, c + 1), uC = cornerUv(p, f, c + 2), uD = cornerUv(p, f, c + 3);
      for (let i = 0; i <= k; i += 1) {
        const t0 = i / (k + 1);
        const t1 = (i + 1) / (k + 1);
        bld.face(
          [left[i]!, left[i + 1]!, right[i + 1]!, right[i]!],
          flatUv([lerpUv(uA, uB, t0), lerpUv(uA, uB, t1), lerpUv(uD, uC, t1), lerpUv(uD, uC, t0)], keepUv),
        );
      }
      return;
    }
    const vs: number[] = [];
    const us: Uv[] = [];
    for (let c = 0; c < n; c += 1) {
      const v = face[c]!;
      const w = face[(c + 1) % n]!;
      vs.push(v);
      us.push(cornerUv(p, f, c));
      if (!cutsOf.has(edgeKey(v, w))) continue;
      pts(v, w).forEach((m, i) => {
        vs.push(m);
        us.push(lerpUv(cornerUv(p, f, c), cornerUv(p, f, c + 1), (i + 1) / (k + 1)));
      });
    }
    bld.face(vs, flatUv(us, keepUv));
  });
  return finish(bld, p, fresh);
}

// ── bevel ───────────────────────────────────────────────────────────────────

interface Pt {
  v: number;
  uv: Uv;
}

/**
 * Ctrl+B: replace each selected edge with a flat chamfer `width` wide.
 *
 * Every face corner at a bevelled vertex is replaced by the points it now
 * ends at: slid along its unselected edge, or set in from both edges where
 * two selected edges meet in it. A strip fills each bevelled edge and a patch
 * fills each vertex where three or more meet. A chamfer along a hard edge
 * keeps hard borders, so the highlight runs along it like a real bevel.
 */
export function bevelEdges(p: Poly, selected: Set<number>, width: number): OpResult {
  const t = topology(p);
  const E = new Set([...selected].filter((k) => t.edgeFaces.get(k)?.length === 2));
  if (!E.size) throw new MeshOpError("Bevel needs edges between two faces — select the edges to bevel.");
  const V = new Set<number>();
  for (const k of E) for (const v of edgeEnds(k)) V.add(v);
  let w = Math.max(0, width);
  for (const v of V) for (const u of t.neighbours[v]!) w = Math.min(w, 0.45 * len(sub(at(p, u), at(p, v))));
  if (w <= 1e-9) throw new MeshOpError("The bevel is too narrow to make.");

  const bld = new Build(p);
  const slides = new Map<number, number>();
  const hasSlide = (v: number, u: number): boolean => {
    if (E.has(edgeKey(v, u))) return false;
    for (const g of t.edgeFaces.get(edgeKey(v, u)) ?? []) {
      const face = p.faces[g]!;
      const c = face.indexOf(v);
      const n = face.length;
      const other = face[(c + 1) % n] === u ? face[(c - 1 + n) % n]! : face[(c + 1) % n]!;
      if (E.has(edgeKey(v, other))) return true;
    }
    return false;
  };
  const slide = (v: number, u: number): number => {
    const key = dirKey(v, u);
    let s = slides.get(key);
    if (s === undefined) {
      s = bld.vert(add(at(p, v), scale(norm(sub(at(p, u), at(p, v))), w)));
      slides.set(key, s);
    }
    return s;
  };
  const cornerPts = (f: number, c: number): Pt[] => {
    const face = p.faces[f]!;
    const n = face.length;
    const v = face[c]!;
    const uv = cornerUv(p, f, c);
    if (!V.has(v)) return [{ v, uv }];
    const prev = face[(c - 1 + n) % n]!;
    const next = face[(c + 1) % n]!;
    const selIn = E.has(edgeKey(prev, v));
    const selOut = E.has(edgeKey(v, next));
    const pv = at(p, v);
    const toPrev = sub(at(p, prev), pv);
    const toNext = sub(at(p, next), pv);
    if (selIn && selOut) {
      const dp = norm(toPrev);
      const dn = norm(toNext);
      const sin = Math.max(len(cross(dp, dn)), 0.3);
      const pos = add(pv, scale(add(dp, dn), w / sin));
      return [{ v: bld.vert(pos), uv: uvInFace(p, f, c, pos) }];
    }
    const out: Pt[] = [];
    if (!selIn && hasSlide(v, prev)) out.push({ v: slide(v, prev), uv: lerpUv(uv, cornerUv(p, f, c - 1), w / len(toPrev)) });
    if (!selOut && hasSlide(v, next)) out.push({ v: slide(v, next), uv: lerpUv(uv, cornerUv(p, f, c + 1), w / len(toNext)) });
    return out.length ? out : [{ v, uv }];
  };
  const ptsOf = p.faces.map((face, f) => face.map((_, c) => cornerPts(f, c)));
  const keepUv = !!p.uvs;
  ptsOf.forEach((corners) => {
    const list = corners.flat();
    bld.face(list.map((x) => x.v), flatUv(list.map((x) => x.uv), keepUv));
  });
  const made = new Set<number>();
  const addFace = (list: Pt[]) => {
    const i = bld.face(list.map((x) => x.v), flatUv(list.map((x) => x.uv), keepUv));
    if (i >= 0) made.add(i);
  };
  for (const k of E) {
    const [x, y] = edgeEnds(k);
    const d1 = t.directed.get(dirKey(x, y));
    const d2 = t.directed.get(dirKey(y, x));
    if (!d1 || !d2) continue;
    const [f1, c1] = d1;
    const [f2, c2] = d2;
    const a1 = ptsOf[f1]![c1]!.at(-1)!;
    const b1 = ptsOf[f1]![(c1 + 1) % p.faces[f1]!.length]![0]!;
    const b2 = ptsOf[f2]![c2]!.at(-1)!;
    const a2 = ptsOf[f2]![(c2 + 1) % p.faces[f2]!.length]![0]!;
    addFace([b1, a1, a2, b2]);
    if (p.sharp.has(k)) bld.sharp.add(edgeKey(a1.v, b1.v)).add(edgeKey(a2.v, b2.v));
  }
  // A patch where the bevel's strips meet around a vertex.
  for (const v of V) {
    const around = t.vertexFaces[v]!;
    const f0 = around[0]!;
    const seq: Pt[] = [];
    let f = f0;
    let closed = false;
    for (let guard = 0; guard <= around.length; guard += 1) {
      const face = p.faces[f]!;
      const c = face.indexOf(v);
      seq.push(...ptsOf[f]![c]!);
      const next = t.directed.get(dirKey(face[(c + 1) % face.length]!, v));
      if (!next) break;
      f = next[0];
      if (f === f0) {
        closed = true;
        break;
      }
    }
    if (!closed) continue;
    const ring = seq.filter((x, i) => x.v !== seq[(i + 1) % seq.length]!.v);
    if (new Set(ring.map((x) => x.v)).size < 3) continue;
    let outward: V3 = [0, 0, 0];
    for (const g of around) outward = add(outward, faceNormalRaw(p, p.faces[g]!));
    if (dot(newellOf(bld.positions, ring.map((x) => x.v)), outward) < 0) ring.reverse();
    addFace(ring);
  }
  return finish(bld, p, undefined, made);
}

// ── inset and extrude ───────────────────────────────────────────────────────

/**
 * I: a smaller copy of the selected faces set in from their border by
 * `thickness` and raised by `depth`, joined to the old border by a ring of
 * quads. As a region, the border is the selection's outline; `individual`
 * insets every face on its own. The selected faces stay selected.
 */
export function insetFaces(p: Poly, faces: Set<number>, thickness: number, depth = 0, individual = false): OpResult {
  if (!faces.size) throw new MeshOpError("Select faces first.");
  const t = topology(p);
  const normals = new Map<number, V3>();
  for (const f of faces) normals.set(f, faceNormal(p, p.faces[f]!));
  const regionNormal = new Map<number, V3>();
  for (const f of faces) {
    for (const v of p.faces[f]!) regionNormal.set(v, add(regionNormal.get(v) ?? [0, 0, 0], normals.get(f)!));
  }
  const isBorder = (f: number, c: number): boolean => {
    if (individual) return true;
    const face = p.faces[f]!;
    const back = t.directed.get(dirKey(face[(c + 1) % face.length]!, face[c]!));
    return !back || !faces.has(back[0]);
  };
  // Along the region's outline: who comes before and after each border vertex.
  const nextOf = new Map<number, number>();
  const prevOf = new Map<number, number>();
  if (!individual) {
    for (const f of faces) {
      const face = p.faces[f]!;
      face.forEach((v, c) => {
        if (!isBorder(f, c)) return;
        const w = face[(c + 1) % face.length]!;
        nextOf.set(v, w);
        prevOf.set(w, v);
      });
    }
  }
  const bld = new Build(p);
  const made = new Map<string, number>();
  const point = (f: number, c: number): number => {
    const face = p.faces[f]!;
    const v = face[c]!;
    const key = individual ? `${f}:${v}` : `${v}`;
    const hit = made.get(key);
    if (hit !== undefined) return hit;
    const prev = individual ? face[(c - 1 + face.length) % face.length]! : prevOf.get(v)!;
    const next = individual ? face[(c + 1) % face.length]! : nextOf.get(v)!;
    const n = individual ? normals.get(f)! : norm(regionNormal.get(v)!);
    const pv = at(p, v);
    const leftIn = norm(cross(n, sub(pv, at(p, prev))));
    const leftOut = norm(cross(n, sub(at(p, next), pv)));
    let m = add(leftIn, leftOut);
    if (len(m) < 1e-6) m = leftIn;
    m = norm(m);
    const s = thickness / Math.max(dot(m, leftIn), 0.25);
    const i = bld.vert(add(add(pv, scale(m, s)), scale(n, depth)));
    made.set(key, i);
    return i;
  };
  const onBorder = (f: number, c: number) => individual || nextOf.has(p.faces[f]![c]!);
  // Vertices inside the region only rise.
  if (depth && !individual) {
    for (const [v, n] of regionNormal) if (!nextOf.has(v)) bld.move(v, add(at(p, v), scale(norm(n), depth)));
  }
  const keepUv = !!p.uvs;
  const inner = new Map<number, Pt[]>();
  p.faces.forEach((face, f) => {
    if (!faces.has(f)) {
      bld.face(face, p.uvs?.[f]);
      return;
    }
    const list = face.map((v, c) => {
      if (!onBorder(f, c)) return { v, uv: cornerUv(p, f, c) };
      const i = point(f, c);
      return { v: i, uv: uvInFace(p, f, c, bld.at(i)) };
    });
    inner.set(f, list);
    bld.face(list.map((x) => x.v), flatUv(list.map((x) => x.uv), keepUv));
  });
  for (const f of faces) {
    const face = p.faces[f]!;
    const list = inner.get(f)!;
    face.forEach((a, c) => {
      if (!isBorder(f, c)) return;
      const n = face.length;
      const b = face[(c + 1) % n]!;
      const ia = list[c]!;
      const ib = list[(c + 1) % n]!;
      bld.face([a, b, ib.v, ia.v], flatUv([cornerUv(p, f, c), cornerUv(p, f, c + 1), ib.uv, ia.uv], keepUv));
    });
  }
  return finish(bld, p, undefined, new Set(faces));
}

/** E on faces: the region pulled out along its normals by `distance`, with walls back to where it was. */
export function extrudeFaces(p: Poly, faces: Set<number>, distance: number): OpResult {
  return insetFaces(p, faces, 0, distance, false);
}

/**
 * E on the open border of a surface: new quads grown outward from the
 * selected border edges, in the plane of the faces they leave. The new
 * border is selected, ready to drag further.
 */
export function extrudeEdges(p: Poly, verts: Set<number>, distance: number): OpResult {
  const t = topology(p);
  const border: { a: number; b: number; f: number; c: number }[] = [];
  for (const [key, faces] of t.edgeFaces) {
    if (faces.length !== 1) continue;
    const [x, y] = edgeEnds(key);
    if (!verts.has(x) || !verts.has(y)) continue;
    const f = faces[0]!;
    const face = p.faces[f]!;
    const cx = face.indexOf(x);
    const forward = face[(cx + 1) % face.length] === y;
    border.push(forward ? { a: x, b: y, f, c: cx } : { a: y, b: x, f, c: face.indexOf(y) });
  }
  if (!border.length) throw new MeshOpError("Select faces, or edges on an open border, to extrude.");
  const out = new Map<number, V3>();
  for (const e of border) {
    const n = faceNormal(p, p.faces[e.f]!);
    const outward = scale(norm(cross(n, sub(at(p, e.b), at(p, e.a)))), -1);
    for (const v of [e.a, e.b]) out.set(v, add(out.get(v) ?? [0, 0, 0], outward));
  }
  const bld = new Build(p);
  const copy = new Map<number, number>();
  for (const [v, dir] of out) copy.set(v, bld.vert(add(at(p, v), scale(norm(dir), distance))));
  p.faces.forEach((face, f) => bld.face(face, p.uvs?.[f]));
  for (const e of border) {
    const ua = cornerUv(p, e.f, e.c);
    const ub = cornerUv(p, e.f, e.c + 1);
    bld.face([e.b, e.a, copy.get(e.a)!, copy.get(e.b)!], flatUv([ub, ua, ua, ub], !!p.uvs));
  }
  return finish(bld, p, new Set(copy.values()));
}

// ── bridge, fill, connect, bisect ───────────────────────────────────────────

/** The open borders among the selected vertices, as closed loops in face order (a→b as the faces run). */
function borderLoops(p: Poly, verts: Set<number>): number[][] {
  const t = topology(p);
  const next = new Map<number, number>();
  for (const [key, faces] of t.edgeFaces) {
    if (faces.length !== 1) continue;
    const [x, y] = edgeEnds(key);
    if (!verts.has(x) || !verts.has(y)) continue;
    const face = p.faces[faces[0]!]!;
    const cx = face.indexOf(x);
    if (face[(cx + 1) % face.length] === y) next.set(x, y);
    else next.set(y, x);
  }
  const loops: number[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let v: number | undefined = start;
    while (v !== undefined && !seen.has(v)) {
      seen.add(v);
      loop.push(v);
      v = next.get(v);
    }
    if (v === start && loop.length >= 3) loops.push(loop);
    else throw new MeshOpError("The selected border is not a closed loop.");
  }
  return loops;
}

/** Bridge two open edge loops with a band of quads (the inside of a tube, a gap between two parts). */
export function bridgeLoops(p: Poly, verts: Set<number>): OpResult {
  const loops = borderLoops(p, verts);
  if (loops.length !== 2) throw new MeshOpError(`Bridge needs exactly two open edge loops selected; found ${loops.length}.`);
  const [A, B] = loops as [number[], number[]];
  if (A.length !== B.length) throw new MeshOpError(`The two loops have ${A.length} and ${B.length} edges; bridge needs the same number.`);
  const n = A.length;
  // Walk B against its own direction, starting wherever pairs up closest.
  let best = 0;
  let bestCost = Infinity;
  for (let s = 0; s < n; s += 1) {
    let cost = 0;
    for (let i = 0; i < n; i += 1) {
      const d = sub(at(p, A[i]!), at(p, B[(((s - i) % n) + n) % n]!));
      cost += dot(d, d);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = s;
    }
  }
  const m = (i: number) => B[(((best - i) % n) + n) % n]!;
  const bld = new Build(p);
  p.faces.forEach((face, f) => bld.face(face, p.uvs?.[f]));
  const made = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    const quad = [A[(i + 1) % n]!, A[i]!, m(i), m(i + 1)];
    const k = bld.face(quad, flatUv(quad.map((v) => anyUv(p, v)), !!p.uvs));
    if (k >= 0) made.add(k);
  }
  return finish(bld, p, undefined, made);
}

/** F: close each selected open loop with one face. */
export function fillLoops(p: Poly, verts: Set<number>): OpResult {
  const loops = borderLoops(p, verts);
  if (!loops.length) throw new MeshOpError("Select the vertices of an open border to fill it.");
  const bld = new Build(p);
  p.faces.forEach((face, f) => bld.face(face, p.uvs?.[f]));
  const made = new Set<number>();
  for (const loop of loops) {
    const face = [...loop].reverse();
    const k = bld.face(face, flatUv(face.map((v) => anyUv(p, v)), !!p.uvs));
    if (k >= 0) made.add(k);
  }
  return finish(bld, p, undefined, made);
}

/** J: split every face that holds two selected, not yet joined, vertices along a new edge between them. */
export function connectVerts(p: Poly, verts: Set<number>): OpResult {
  const bld = new Build(p);
  let split = 0;
  p.faces.forEach((face, f) => {
    const n = face.length;
    const sel = face.map((v, c) => (verts.has(v) ? c : -1)).filter((c) => c >= 0);
    const uv = p.uvs?.[f];
    if (sel.length === 2) {
      const [i, j] = sel as [number, number];
      if (j - i !== 1 && j - i !== n - 1) {
        const one = Array.from({ length: j - i + 1 }, (_, k) => i + k);
        const two = Array.from({ length: n - (j - i) + 1 }, (_, k) => (j + k) % n);
        for (const part of [one, two]) bld.face(part.map((c) => face[c]!), uv ? part.flatMap((c) => [uv[c * 2]!, uv[c * 2 + 1]!]) : null);
        split += 1;
        return;
      }
    }
    bld.face(face, uv);
  });
  if (!split) throw new MeshOpError("Select two vertices of one face that are not already joined by an edge.");
  return finish(bld, p, new Set(verts));
}

/**
 * Knife along a plane: cut every face the plane `axis = offset` crosses, adding
 * vertices where it crosses edges and an edge across each face. The cut is
 * selected.
 */
export function bisect(p: Poly, axis: Axis, offset: number): OpResult {
  const eps = 1e-6;
  const d = (v: number) => p.positions[v * 3 + axis]! - offset;
  const bld = new Build(p);
  const cut = new Map<number, number>();
  const onPlane = new Set<number>();
  for (let v = 0; v < vertexTotal(p); v += 1) if (Math.abs(d(v)) <= eps) onPlane.add(v);
  const crossing = (v: number, w: number): number => {
    const key = edgeKey(v, w);
    let m = cut.get(key);
    if (m === undefined) {
      const [x, y] = edgeEnds(key);
      m = bld.vert(lerp3(at(p, x), at(p, y), d(x) / (d(x) - d(y))));
      cut.set(key, m);
      onPlane.add(m);
      // A marked edge cut in two is two marked edges.
      for (const [marks, out] of [[p.sharp, bld.sharp], [p.seams, bld.seams]] as const) {
        if (marks.has(key)) out.add(edgeKey(x, m)).add(edgeKey(m, y));
      }
    }
    return m;
  };
  p.faces.forEach((face, f) => {
    const n = face.length;
    const vs: number[] = [];
    const us: Uv[] = [];
    for (let c = 0; c < n; c += 1) {
      const v = face[c]!;
      const w = face[(c + 1) % n]!;
      vs.push(v);
      us.push(cornerUv(p, f, c));
      if (Math.abs(d(v)) > eps && Math.abs(d(w)) > eps && d(v) * d(w) < 0) {
        vs.push(crossing(v, w));
        us.push(lerpUv(cornerUv(p, f, c), cornerUv(p, f, c + 1), d(v) / (d(v) - d(w))));
      }
    }
    const on = vs.map((v, i) => (onPlane.has(v) ? i : -1)).filter((i) => i >= 0);
    const m = vs.length;
    if (on.length === 2 && on[1]! - on[0]! !== 1 && on[1]! - on[0]! !== m - 1) {
      const [i, j] = on as [number, number];
      const one = Array.from({ length: j - i + 1 }, (_, k) => i + k);
      const two = Array.from({ length: m - (j - i) + 1 }, (_, k) => (j + k) % m);
      for (const part of [one, two]) bld.face(part.map((k) => vs[k]!), flatUv(part.map((k) => us[k]!), !!p.uvs));
    } else {
      bld.face(vs, flatUv(us, !!p.uvs));
    }
  });
  return finish(bld, p, onPlane);
}

// ── merge, dissolve, delete ─────────────────────────────────────────────────

/** Point every vertex at `remap[v]`, drop faces that collapse, and tidy up. */
export function weld(p: Poly, remap: Int32Array, positions?: number[]): Poly {
  const bld = new Build(p);
  if (positions) bld.positions = positions.slice();
  bld.sharp = remapMarks(p.sharp, (v) => remap[v]!);
  bld.seams = remapMarks(p.seams, (v) => remap[v]!);
  p.faces.forEach((face, f) => {
    const uv = p.uvs?.[f];
    const vs: number[] = [];
    const us: number[] = [];
    face.forEach((v, c) => {
      const r = remap[v]!;
      if (vs.length && vs[vs.length - 1] === r) return;
      vs.push(r);
      if (uv) us.push(uv[c * 2]!, uv[c * 2 + 1]!);
    });
    while (vs.length > 1 && vs[0] === vs[vs.length - 1]) {
      vs.pop();
      us.splice(-2, 2);
    }
    // A face pinched onto itself is no longer a face.
    if (vs.length < 3 || new Set(vs).size !== vs.length) return;
    bld.face(vs, uv ? us : null);
  });
  return compactPoly(bld.done(p.modifiers)).poly;
}

/** M: the selected vertices become one, at their centre. */
export function mergeAtCenter(p: Poly, verts: Set<number>): OpResult {
  if (verts.size < 2) throw new MeshOpError("Select two or more vertices to merge.");
  let c: V3 = [0, 0, 0];
  for (const v of verts) c = add(c, at(p, v));
  c = scale(c, 1 / verts.size);
  const target = Math.min(...verts);
  const remap = new Int32Array(vertexTotal(p)).map((_, i) => (verts.has(i) ? target : i));
  const positions = p.positions.slice();
  positions[target * 3] = c[0];
  positions[target * 3 + 1] = c[1];
  positions[target * 3 + 2] = c[2];
  const merged = weld(p, remap, positions);
  // `weld` renumbers; the merged vertex is wherever the target's position landed.
  let found = -1;
  for (let v = 0; v < vertexTotal(merged) && found < 0; v += 1) {
    const q = at(merged, v);
    if (q[0] === c[0] && q[1] === c[1] && q[2] === c[2]) found = v;
  }
  return { poly: merged, verts: found >= 0 ? new Set([found]) : new Set() };
}

/** Weld vertices closer than `distance` (all of them, or within `only`). */
export function mergeByDistancePoly(p: Poly, distance = 1e-4, only?: Set<number>): Poly {
  const n = vertexTotal(p);
  const cell = Math.max(distance, 1e-9);
  const grid = new Map<string, number[]>();
  const remap = new Int32Array(n).map((_, i) => i);
  for (let i = 0; i < n; i += 1) {
    if (only && !only.has(i)) continue;
    const q = at(p, i);
    const cx = Math.floor(q[0] / cell), cy = Math.floor(q[1] / cell), cz = Math.floor(q[2] / cell);
    let found = -1;
    search: for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const e = sub(at(p, j), q);
            if (dot(e, e) <= distance * distance) {
              found = j;
              break search;
            }
          }
        }
      }
    }
    if (found >= 0) remap[i] = found;
    else {
      const key = `${cx},${cy},${cz}`;
      grid.set(key, [...(grid.get(key) ?? []), i]);
    }
  }
  return weld(p, remap);
}

/**
 * Join groups of faces into one face each: a group becomes the loop around
 * its outside. A group whose outside is not one simple loop (a band, a
 * group with a hole) is left as it was.
 */
function joinFaceGroups(p: Poly, pairs: [number, number][]): { poly: Poly; joined: number } {
  const groups = unionFind(p.faces.length);
  for (const [f, g] of pairs) groups.union(f, g);
  const members = new Map<number, number[]>();
  p.faces.forEach((_, f) => {
    const r = groups.find(f);
    members.set(r, [...(members.get(r) ?? []), f]);
  });
  const t = topology(p);
  const replaced = new Map<number, { v: number[]; uv: number[] | null }>();
  const absorbed = new Set<number>();
  for (const [root, list] of members) {
    if (list.length < 2) continue;
    const inGroup = new Set(list);
    const next = new Map<number, { to: number; uv: Uv }>();
    let simple = true;
    let count = 0;
    for (const f of list) {
      const face = p.faces[f]!;
      face.forEach((a, c) => {
        const b = face[(c + 1) % face.length]!;
        const back = t.directed.get(dirKey(b, a));
        if (back && inGroup.has(back[0])) return;
        if (next.has(a)) simple = false;
        next.set(a, { to: b, uv: cornerUv(p, f, c) });
        count += 1;
      });
    }
    if (!simple || !count) continue;
    const start = next.keys().next().value!;
    const loop: number[] = [];
    const uvs: number[] = [];
    let v = start;
    do {
      const step = next.get(v);
      if (!step) break;
      loop.push(v);
      uvs.push(...(step.uv ?? [0, 0]));
      v = step.to;
    } while (v !== start && loop.length <= count);
    if (loop.length !== count || v !== start) continue;
    replaced.set(Math.min(root, ...list), { v: loop, uv: p.uvs ? uvs : null });
    for (const f of list) absorbed.add(f);
  }
  const bld = new Build(p);
  p.faces.forEach((face, f) => {
    const r = replaced.get(f);
    if (r) bld.face(r.v, r.uv);
    else if (!absorbed.has(f)) bld.face(face, p.uvs?.[f]);
  });
  return { poly: bld.done(p.modifiers), joined: replaced.size };
}

/** Take vertices with only two edges left out of the faces they sit in — the leftovers of a dissolved loop. */
function dropTwoEdgeVertices(p: Poly, candidates: Iterable<number>): Poly {
  const t = topology(p);
  const drop = new Set<number>();
  for (const v of candidates) if (v < vertexTotal(p) && t.neighbours[v]!.length === 2) drop.add(v);
  if (!drop.size) return p;
  const bld = new Build(p);
  p.faces.forEach((face, f) => {
    const keep = face.map((v, c) => (drop.has(v) ? -1 : c)).filter((c) => c >= 0);
    const uv = p.uvs?.[f];
    if (keep.length < 3) bld.face(face, uv);
    else bld.face(keep.map((c) => face[c]!), uv ? keep.flatMap((c) => [uv[c * 2]!, uv[c * 2 + 1]!]) : null);
  });
  return bld.done(p.modifiers);
}

/** Dissolve edges: the two faces each one separates become one, and the vertices left with two edges go. */
export function dissolveEdges(p: Poly, edges: Set<number>): OpResult {
  const t = topology(p);
  const pairs: [number, number][] = [];
  for (const k of edges) {
    const faces = t.edgeFaces.get(k);
    if (faces?.length === 2 && faces[0] !== faces[1]) pairs.push([faces[0]!, faces[1]!]);
  }
  if (!pairs.length) throw new MeshOpError("Select edges between two faces to dissolve.");
  const { poly, joined } = joinFaceGroups(p, pairs);
  if (!joined) throw new MeshOpError("Those edges cannot be dissolved without leaving a hole in a face.");
  const ends = new Set<number>();
  for (const k of edges) for (const v of edgeEnds(k)) ends.add(v);
  return { poly: compactPoly(dropTwoEdgeVertices(poly, ends)).poly, verts: new Set() };
}

/** Dissolve faces: neighbouring selected faces become one n-gon. */
export function dissolveFaces(p: Poly, faces: Set<number>): OpResult {
  const t = topology(p);
  const pairs: [number, number][] = [];
  for (const f of faces) {
    const face = p.faces[f]!;
    face.forEach((a, c) => {
      const back = t.directed.get(dirKey(face[(c + 1) % face.length]!, a));
      if (back && faces.has(back[0]) && back[0] !== f) pairs.push([f, back[0]]);
    });
  }
  if (!pairs.length) throw new MeshOpError("Select two or more neighbouring faces to dissolve.");
  const { poly, joined } = joinFaceGroups(p, pairs);
  if (!joined) throw new MeshOpError("Those faces do not make one simple face.");
  return { poly: compactPoly(poly).poly, verts: new Set() };
}

/** Dissolve vertices: each one's faces become one face without it. */
export function dissolveVerts(p: Poly, verts: Set<number>): OpResult {
  const t = topology(p);
  const pairs: [number, number][] = [];
  for (const v of verts) {
    const around = t.vertexFaces[v]!;
    for (let i = 1; i < around.length; i += 1) pairs.push([around[0]!, around[i]!]);
  }
  if (!pairs.length) throw new MeshOpError("Select vertices with more than one face around them.");
  const { poly } = joinFaceGroups(p, pairs);
  return { poly: compactPoly(dropTwoEdgeVertices(poly, verts)).poly, verts: new Set() };
}

/** X in vertex mode: the vertices and every face that uses one. */
export function deleteVertsPoly(p: Poly, verts: Set<number>): Poly {
  const bld = new Build(p);
  p.faces.forEach((face, f) => {
    if (!face.some((v) => verts.has(v))) bld.face(face, p.uvs?.[f]);
  });
  return compactPoly(bld.done(p.modifiers)).poly;
}

/** X in face mode: the faces, and any vertex left without one. */
export function deleteFacesPoly(p: Poly, faces: Set<number>): Poly {
  const bld = new Build(p);
  p.faces.forEach((face, f) => {
    if (!faces.has(f)) bld.face(face, p.uvs?.[f]);
  });
  return compactPoly(bld.done(p.modifiers)).poly;
}

/** X in edge mode: every face along a selected edge. */
export function deleteEdgesPoly(p: Poly, edges: Set<number>): Poly {
  const bld = new Build(p);
  p.faces.forEach((face, f) => {
    const hit = face.some((v, c) => edges.has(edgeKey(v, face[(c + 1) % face.length]!)));
    if (!hit) bld.face(face, p.uvs?.[f]);
  });
  return compactPoly(bld.done(p.modifiers)).poly;
}

// ── symmetry, sharpness, whole-mesh ─────────────────────────────────────────

/**
 * Make the mesh symmetric across its own plane on `axis`: cut it there, throw
 * away the side being replaced, and mirror the kept side over, welded at the
 * seam.
 */
export function symmetrize(p: Poly, axis: Axis, keepPositive = true): Poly {
  const eps = 1e-5;
  const cutUp = bisect(p, axis, 0).poly;
  const sign = keepPositive ? 1 : -1;
  const bld = new Build(cutUp);
  cutUp.faces.forEach((face, f) => {
    if (face.every((v) => sign * cutUp.positions[v * 3 + axis]! >= -eps)) bld.face(face, cutUp.uvs?.[f]);
  });
  const half = compactPoly(bld.done(cutUp.modifiers)).poly;
  if (!half.faces.length) throw new MeshOpError("Nothing is on the side being kept.");
  return mirrorPoly(half, axis, eps);
}

export function setSharp(p: Poly, edges: Iterable<number>, sharp: boolean): Poly {
  const next = new Set(p.sharp);
  for (const k of edges) {
    if (sharp) next.add(k);
    else next.delete(k);
  }
  return { ...p, sharp: next };
}

/** Turn every face inside out. */
export function flipPoly(p: Poly): Poly {
  const faces = p.faces.map((f) => [f[0]!, ...f.slice(1).reverse()]);
  const uvs = p.uvs?.map((uv) => {
    const n = uv.length / 2;
    const order = [0, ...Array.from({ length: n - 1 }, (_, i) => n - 1 - i)];
    return order.flatMap((c) => [uv[c * 2]!, uv[c * 2 + 1]!]);
  });
  return { ...p, faces, uvs: uvs ?? null };
}

/** Bake a transform (a column-major 4×4, as three.js stores it) into the vertices. */
export function transformPoly(p: Poly, e: ArrayLike<number>): Poly {
  const src = p.positions;
  const positions = new Array<number>(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i]!, y = src[i + 1]!, z = src[i + 2]!;
    const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
    positions[i] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w;
    positions[i + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w;
    positions[i + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w;
  }
  const det =
    e[0]! * (e[5]! * e[10]! - e[6]! * e[9]!) - e[4]! * (e[1]! * e[10]! - e[2]! * e[9]!) + e[8]! * (e[1]! * e[6]! - e[2]! * e[5]!);
  const moved = { ...p, positions };
  return det < 0 ? flipPoly(moved) : moved;
}

/** Several cages as one; UVs survive only if every part has them, modifiers come from the first. */
export function joinPolys(parts: Poly[]): Poly {
  const all = parts.length > 0 && parts.every((q) => q.uvs);
  const out: Poly = { positions: [], faces: [], uvs: all ? [] : null, sharp: new Set(), seams: new Set(), modifiers: parts[0]?.modifiers ?? [] };
  for (const q of parts) {
    const base = out.positions.length / 3;
    out.positions.push(...q.positions);
    q.faces.forEach((f, i) => {
      out.faces.push(f.map((v) => v + base));
      if (out.uvs) out.uvs.push(q.uvs![i]!.slice());
    });
    for (const k of q.sharp) {
      const [a, b] = edgeEnds(k);
      out.sharp.add(edgeKey(a + base, b + base));
    }
    for (const k of q.seams) {
      const [a, b] = edgeEnds(k);
      out.seams.add(edgeKey(a + base, b + base));
    }
  }
  return out;
}

/** Laplacian smoothing over the cage, of every vertex or those in `only`. Border vertices follow the border. */
export function smoothPoly(p: Poly, strength = 0.5, iterations = 1, only?: Set<number>): Poly {
  const t = topology(p);
  let positions = p.positions.slice();
  const borderNb = (v: number) => t.neighbours[v]!.filter((u) => t.edgeFaces.get(edgeKey(v, u))!.length === 1);
  for (let it = 0; it < iterations; it += 1) {
    const next = positions.slice();
    for (let v = 0; v < vertexTotal(p); v += 1) {
      if (only && !only.has(v)) continue;
      const border = borderNb(v);
      const nb = border.length ? border : t.neighbours[v]!;
      if (!nb.length) continue;
      for (let k = 0; k < 3; k += 1) {
        let sum = 0;
        for (const u of nb) sum += positions[u * 3 + k]!;
        next[v * 3 + k] = positions[v * 3 + k]! + (sum / nb.length - positions[v * 3 + k]!) * strength;
      }
    }
    positions = next;
  }
  return { ...p, positions };
}
