import {
  add,
  at,
  cornerUv,
  cross,
  dirKey,
  dot,
  edgeKey,
  faceNormalRaw,
  len,
  norm,
  scale,
  sub,
  topology,
  unionFind,
  type Poly,
  type V3,
} from "./poly";
import { triangulateFace } from "./polymesh";
import { MeshOpError } from "./polyops";

/**
 * UV unwrapping: laying the cage's surface out flat so a 2D texture can be
 * painted onto it.
 *
 * - `unwrap` cuts the surface along its marked seams and flattens each piece
 *   (an island) with least-squares conformal maps (Lévy et al. 2002): the
 *   flat layout that keeps angles as true as it can, so a checker stays
 *   square.
 * - `smartProject` needs no seams: it groups faces that point roughly the
 *   same way and projects each group flat — the quick answer for hard-surface
 *   props.
 * - `packIslands` scales every island to the same texel density, turns it to
 *   its tightest bounding box and shelf-packs them into the 0–1 square.
 *
 * All pure: a cage in, a cage with new UVs (and seams) out.
 */

export class UvError extends MeshOpError {}

type Ref = [number, number]; // [face, corner]

function cornerStarts(p: Poly): Int32Array {
  const starts = new Int32Array(p.faces.length + 1);
  p.faces.forEach((f, i) => (starts[i + 1] = starts[i]! + f.length));
  return starts;
}

function triArea(a: V3, b: V3, c: V3): number {
  return len(cross(sub(b, a), sub(c, a))) / 2;
}

const uvArea = (a: [number, number], b: [number, number], c: [number, number]) =>
  ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

function faceArea3(p: Poly, f: number): number {
  return len(faceNormalRaw(p, p.faces[f]!)) / 2;
}

/** The signed UV area of a face (positive when its UVs wind the same way as the face). */
function faceAreaUv(p: Poly, f: number): number {
  const uv = p.uvs?.[f];
  if (!uv) return 0;
  let a = 0;
  const n = uv.length / 2;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    a += uv[i * 2]! * uv[j * 2 + 1]! - uv[j * 2]! * uv[i * 2 + 1]!;
  }
  return a / 2;
}

function withUvs(p: Poly): number[][] {
  return p.uvs ? p.uvs.map((u) => u.slice()) : p.faces.map((f) => new Array<number>(f.length * 2).fill(0));
}

// ── islands ─────────────────────────────────────────────────────────────────

/**
 * Pieces to unwrap: faces of `faces` joined across edges that are not seams.
 * Corners joined across those same edges are one UV vertex (`root`), so a
 * seam that does not cut a piece all the way through is still a slit.
 */
export function seamCharts(p: Poly, faces: Set<number>): { charts: number[][]; root: (f: number, c: number) => number } {
  const t = topology(p);
  const starts = cornerStarts(p);
  const byFace = unionFind(p.faces.length);
  const corners = unionFind(starts[p.faces.length]!);
  for (const f of faces) {
    const face = p.faces[f]!;
    for (let c = 0; c < face.length; c += 1) {
      const a = face[c]!;
      const b = face[(c + 1) % face.length]!;
      const key = edgeKey(a, b);
      if (p.seams.has(key) || t.edgeFaces.get(key)!.length !== 2) continue;
      const other = t.directed.get(dirKey(b, a));
      if (!other || !faces.has(other[0]) || other[0] === f) continue;
      const [g, k] = other;
      byFace.union(f, g);
      corners.union(starts[f]! + c, starts[g]! + ((k + 1) % p.faces[g]!.length));
      corners.union(starts[f]! + ((c + 1) % face.length), starts[g]! + k);
    }
  }
  const groups = new Map<number, number[]>();
  for (const f of [...faces].sort((a, b) => a - b)) {
    const r = byFace.find(f);
    groups.set(r, [...(groups.get(r) ?? []), f]);
  }
  return { charts: [...groups.values()], root: (f, c) => corners.find(starts[f]! + c) };
}

/** Islands as the UVs already have them: faces joined where both ends of their shared edge have the same UV. */
export function uvIslands(p: Poly, faces?: Set<number>): number[][] {
  const t = topology(p);
  const inSet = (f: number) => !faces || faces.has(f);
  const groups = unionFind(p.faces.length);
  p.faces.forEach((face, f) => {
    if (!inSet(f)) return;
    for (let c = 0; c < face.length; c += 1) {
      const a = face[c]!;
      const b = face[(c + 1) % face.length]!;
      const other = t.directed.get(dirKey(b, a));
      if (!other || !inSet(other[0])) continue;
      const [g, k] = other;
      const same = (u1: [number, number] | null, u2: [number, number] | null) =>
        !!u1 && !!u2 && Math.abs(u1[0] - u2[0]) < 1e-6 && Math.abs(u1[1] - u2[1]) < 1e-6;
      if (same(cornerUv(p, f, c), cornerUv(p, g, k + 1)) && same(cornerUv(p, f, c + 1), cornerUv(p, g, k))) groups.union(f, g);
    }
  });
  const out = new Map<number, number[]>();
  p.faces.forEach((_, f) => {
    if (!inSet(f)) return;
    const r = groups.find(f);
    out.set(r, [...(out.get(r) ?? []), f]);
  });
  return [...out.values()];
}

// ── LSCM ────────────────────────────────────────────────────────────────────

/**
 * Flatten one chart conformally. Returns a UV per corner root, or null when
 * the chart is closed (no border to open it from — it needs a seam).
 */
function lscm(p: Poly, chart: number[], root: (f: number, c: number) => number): Map<number, [number, number]> | null {
  const local = new Map<number, number>();
  const pos: V3[] = [];
  for (const f of chart) {
    p.faces[f]!.forEach((v, c) => {
      const r = root(f, c);
      if (!local.has(r)) {
        local.set(r, pos.length);
        pos.push(at(p, v));
      }
    });
  }
  const n = pos.length;
  // Border: chart edges (between UV vertices) used once.
  const edgeUse = new Map<number, number>();
  for (const f of chart) {
    const face = p.faces[f]!;
    for (let c = 0; c < face.length; c += 1) {
      const k = edgeKey(local.get(root(f, c))!, local.get(root(f, (c + 1) % face.length))!);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  const border = new Set<number>();
  for (const [k, count] of edgeUse) {
    if (count === 1) {
      border.add(Math.floor(k / 67_108_864));
      border.add(k % 67_108_864);
    }
  }
  if (!border.size) return null;

  // A first guess: the chart projected onto its average plane.
  let normal: V3 = [0, 0, 0];
  for (const f of chart) normal = add(normal, faceNormalRaw(p, p.faces[f]!));
  normal = norm(normal);
  if (len(normal) < 0.5) normal = [0, 1, 0];
  const tAxis = norm(cross(Math.abs(normal[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0], normal));
  const bAxis = cross(normal, tAxis);
  const x = new Float64Array(n * 2);
  pos.forEach((q, i) => {
    x[i * 2] = dot(q, tAxis);
    x[i * 2 + 1] = dot(q, bAxis);
  });

  // Pin the two border vertices farthest apart, where the guess put them.
  const list = [...border];
  const far = (from: number) => {
    let best = from;
    let d = -1;
    for (const i of list) {
      const e = sub(pos[i]!, pos[from]!);
      const dd = dot(e, e);
      if (dd > d) {
        d = dd;
        best = i;
      }
    }
    return best;
  };
  const pinA = far(list[0]!);
  const pinB = far(pinA);
  const pinned = new Uint8Array(n * 2);
  for (const i of [pinA, pinB]) pinned[i * 2] = pinned[i * 2 + 1] = 1;
  // The pins sit their true distance apart, along the direction the guess
  // gave them (a closed-ish shape can project both onto one point).
  const gap = len(sub(pos[pinB]!, pos[pinA]!));
  let du = x[pinB * 2]! - x[pinA * 2]!;
  let dv = x[pinB * 2 + 1]! - x[pinA * 2 + 1]!;
  const dl = Math.hypot(du, dv);
  if (dl < 1e-9 * Math.max(gap, 1e-9)) [du, dv] = [1, 0];
  else [du, dv] = [du / dl, dv / dl];
  x[pinB * 2] = x[pinA * 2]! + du * gap;
  x[pinB * 2 + 1] = x[pinA * 2 + 1]! + dv * gap;

  // Rows of the conformal energy: two per triangle, six entries each.
  const rowIdx: number[] = [];
  const rowVal: number[] = [];
  for (const f of chart) {
    const face = p.faces[f]!;
    const tris = triangulateFace(p, face);
    for (let k = 0; k < tris.length; k += 3) {
      const ids = [0, 1, 2].map((j) => local.get(root(f, tris[k + j]!))!);
      const [p0, p1, p2] = ids.map((i) => pos[i]!) as [V3, V3, V3];
      const e1 = sub(p1, p0);
      const e2 = sub(p2, p0);
      const l1 = len(e1);
      const nrm = cross(e1, e2);
      const area = len(nrm) / 2;
      if (l1 < 1e-12 || area < 1e-14) continue;
      const xa = scale(e1, 1 / l1);
      const ya = norm(cross(nrm, xa));
      const xs = [0, l1, dot(e2, xa)];
      const ys = [0, 0, dot(e2, ya)];
      const s = 1 / Math.sqrt(2 * area);
      const wr = [(xs[2]! - xs[1]!) * s, (xs[0]! - xs[2]!) * s, (xs[1]! - xs[0]!) * s];
      const wi = [(ys[2]! - ys[1]!) * s, (ys[0]! - ys[2]!) * s, (ys[1]! - ys[0]!) * s];
      // Real part: Σ wr·u − wi·v ; imaginary part: Σ wi·u + wr·v.
      for (let j = 0; j < 3; j += 1) {
        rowIdx.push(ids[j]! * 2, ids[j]! * 2 + 1);
        rowVal.push(wr[j]!, -wi[j]!);
      }
      for (let j = 0; j < 3; j += 1) {
        rowIdx.push(ids[j]! * 2, ids[j]! * 2 + 1);
        rowVal.push(wi[j]!, wr[j]!);
      }
    }
  }
  const rows = rowVal.length / 6;
  // Conjugate gradients on the normal equations over the free variables, preconditioned by the diagonal.
  const vars = n * 2;
  const rhs = new Float64Array(vars);
  const diag = new Float64Array(vars);
  for (let r = 0; r < rows; r += 1) {
    let pinnedSum = 0;
    for (let k = r * 6; k < r * 6 + 6; k += 1) if (pinned[rowIdx[k]!]) pinnedSum += rowVal[k]! * x[rowIdx[k]!]!;
    for (let k = r * 6; k < r * 6 + 6; k += 1) {
      const v = rowIdx[k]!;
      if (pinned[v]) continue;
      rhs[v] = rhs[v]! - rowVal[k]! * pinnedSum;
      diag[v] = diag[v]! + rowVal[k]! * rowVal[k]!;
    }
  }
  const apply = (vec: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let r = 0; r < rows; r += 1) {
      let sum = 0;
      for (let k = r * 6; k < r * 6 + 6; k += 1) if (!pinned[rowIdx[k]!]) sum += rowVal[k]! * vec[rowIdx[k]!]!;
      for (let k = r * 6; k < r * 6 + 6; k += 1) {
        const v = rowIdx[k]!;
        if (!pinned[v]) out[v] = out[v]! + rowVal[k]! * sum;
      }
    }
  };
  const ax = new Float64Array(vars);
  apply(x, ax);
  const res = new Float64Array(vars);
  const z = new Float64Array(vars);
  const dir = new Float64Array(vars);
  const ad = new Float64Array(vars);
  let rz = 0;
  let bNorm = 0;
  for (let v = 0; v < vars; v += 1) {
    if (pinned[v]) continue;
    res[v] = rhs[v]! - ax[v]!;
    z[v] = diag[v]! > 0 ? res[v]! / diag[v]! : res[v]!;
    dir[v] = z[v]!;
    rz += res[v]! * z[v]!;
    bNorm += rhs[v]! * rhs[v]!;
  }
  const tolerance = 1e-20 * Math.max(bNorm, 1e-12);
  for (let it = 0; it < 4000 && rz > tolerance; it += 1) {
    apply(dir, ad);
    let dAd = 0;
    for (let v = 0; v < vars; v += 1) dAd += dir[v]! * ad[v]!;
    if (dAd <= 0) break;
    const alpha = rz / dAd;
    let next = 0;
    for (let v = 0; v < vars; v += 1) {
      if (pinned[v]) continue;
      x[v] = x[v]! + alpha * dir[v]!;
      res[v] = res[v]! - alpha * ad[v]!;
      z[v] = diag[v]! > 0 ? res[v]! / diag[v]! : res[v]!;
      next += res[v]! * z[v]!;
    }
    const beta = next / rz;
    rz = next;
    for (let v = 0; v < vars; v += 1) if (!pinned[v]) dir[v] = z[v]! + beta * dir[v]!;
  }
  const out = new Map<number, [number, number]>();
  for (const [r, i] of local) out.set(r, [x[i * 2]!, x[i * 2 + 1]!]);
  return out;
}

// ── unwrap, project, pack ───────────────────────────────────────────────────

/** Which faces an operation works on: the given ones, or all. */
const targetFaces = (p: Poly, faces: Set<number> | null) => (faces && faces.size ? faces : new Set(p.faces.keys()));

/**
 * U: cut along the seams and flatten each piece conformally, then pack the
 * new islands into the 0–1 square. A piece with no border at all (a closed
 * surface with no seam through it) is projected instead; `projected` says
 * how many faces that took.
 */
export function unwrap(p: Poly, faces: Set<number> | null, margin = 0.01): { poly: Poly; projected: number } {
  const target = targetFaces(p, faces);
  const { charts, root } = seamCharts(p, target);
  const uvs = withUvs(p);
  const closed = new Set<number>();
  for (const chart of charts) {
    const flat = lscm(p, chart, root);
    if (!flat) {
      for (const f of chart) closed.add(f);
      continue;
    }
    // Keep the layout the right way round: counter-clockwise like the faces.
    let signed = 0;
    for (const f of chart) {
      const face = p.faces[f]!;
      for (let c = 1; c + 1 < face.length; c += 1) signed += uvArea(flat.get(root(f, 0))!, flat.get(root(f, c))!, flat.get(root(f, c + 1))!);
    }
    const flip = signed < 0 ? -1 : 1;
    for (const f of chart) {
      p.faces[f]!.forEach((_, c) => {
        const uv = flat.get(root(f, c))!;
        uvs[f]![c * 2] = uv[0] * flip;
        uvs[f]![c * 2 + 1] = uv[1];
      });
    }
  }
  let out: Poly = { ...p, uvs };
  let islands = charts.filter((c) => !closed.has(c[0]!));
  if (closed.size) {
    const projected = projectCharts(out, closed, 66);
    out = projected.poly;
    islands = [...islands, ...projected.charts];
  }
  return { poly: packIslands(out, islands, margin), projected: closed.size };
}

/** Group faces by facing: each chart grows from its largest face across neighbours within `angle` of it. */
function projectCharts(p: Poly, target: Set<number>, angle: number): { poly: Poly; charts: number[][] } {
  const t = topology(p);
  const cos = Math.cos((angle * Math.PI) / 180);
  const normals = p.faces.map((f) => norm(faceNormalRaw(p, f)));
  const order = [...target].sort((a, b) => faceArea3(p, b) - faceArea3(p, a) || a - b);
  const chartOf = new Int32Array(p.faces.length).fill(-1);
  const charts: number[][] = [];
  for (const seed of order) {
    if (chartOf[seed] !== -1) continue;
    const id = charts.length;
    const members = [seed];
    chartOf[seed] = id;
    const n0 = normals[seed]!;
    for (let i = 0; i < members.length; i += 1) {
      const face = p.faces[members[i]!]!;
      for (let c = 0; c < face.length; c += 1) {
        for (const g of t.edgeFaces.get(edgeKey(face[c]!, face[(c + 1) % face.length]!)) ?? []) {
          if (chartOf[g] !== -1 || !target.has(g) || dot(normals[g]!, n0) < cos) continue;
          chartOf[g] = id;
          members.push(g);
        }
      }
    }
    charts.push(members);
  }
  const uvs = withUvs(p);
  for (const members of charts) {
    let normal: V3 = [0, 0, 0];
    for (const f of members) normal = add(normal, scale(normals[f]!, faceArea3(p, f)));
    normal = len(normal) > 1e-12 ? norm(normal) : normals[members[0]!]!;
    const tAxis = norm(cross(Math.abs(normal[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0], normal));
    const bAxis = cross(normal, tAxis);
    for (const f of members) {
      p.faces[f]!.forEach((v, c) => {
        const q = at(p, v);
        uvs[f]![c * 2] = dot(q, tAxis);
        uvs[f]![c * 2 + 1] = dot(q, bAxis);
      });
    }
  }
  // Where two charts meet is now a seam.
  const seams = new Set(p.seams);
  for (const f of target) {
    const face = p.faces[f]!;
    for (let c = 0; c < face.length; c += 1) {
      const key = edgeKey(face[c]!, face[(c + 1) % face.length]!);
      const faces = t.edgeFaces.get(key)!;
      if (faces.some((g) => g !== f && target.has(g) && chartOf[g] !== chartOf[f])) seams.add(key);
    }
  }
  return { poly: { ...p, uvs, seams }, charts };
}

/**
 * Smart UV project: no seams needed. Faces pointing within `angle` of each
 * other are projected flat together; the borders between groups become
 * seams; the islands are packed.
 */
export function smartProject(p: Poly, faces: Set<number> | null, angle = 66, margin = 0.01): Poly {
  const { poly, charts } = projectCharts(p, targetFaces(p, faces), angle);
  return packIslands(poly, charts, margin);
}

/**
 * Pack islands (face lists; by default every island the UVs have) into the
 * 0–1 square: each scaled to the same texel density, turned to its tightest
 * bounding box, then shelf-packed tallest first with `margin` between them.
 */
export function packIslands(p: Poly, islands?: number[][], margin = 0.01, rotate = true): Poly {
  if (!p.uvs) throw new UvError("This mesh has no UVs to pack — unwrap it first.");
  const list = (islands ?? uvIslands(p)).filter((i) => i.length);
  if (!list.length) return p;
  const uvs = p.uvs.map((u) => u.slice());
  type Box = { refs: Ref[]; pts: [number, number][]; w: number; h: number; x: number; y: number };
  const boxes: Box[] = [];
  for (const faces of list) {
    const refs: Ref[] = [];
    for (const f of faces) p.faces[f]!.forEach((_, c) => refs.push([f, c]));
    let pts = refs.map(([f, c]) => [uvs[f]![c * 2]!, uvs[f]![c * 2 + 1]!] as [number, number]);
    // Same texel density everywhere: UV area matches surface area.
    let a3 = 0;
    let auv = 0;
    for (const f of faces) {
      a3 += faceArea3(p, f);
      auv += Math.abs(faceAreaUv({ ...p, uvs }, f));
    }
    const k = auv > 1e-18 && a3 > 0 ? Math.sqrt(a3 / auv) : 1;
    pts = pts.map(([u, v]) => [u * k, v * k]);
    if (rotate) {
      let best = 0;
      let bestArea = Infinity;
      for (let deg = 0; deg < 90; deg += 3) {
        const r = (deg * Math.PI) / 180;
        const cs = Math.cos(r), sn = Math.sin(r);
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const [u, v] of pts) {
          const ru = u * cs - v * sn;
          const rv = u * sn + v * cs;
          if (ru < minU) minU = ru;
          if (ru > maxU) maxU = ru;
          if (rv < minV) minV = rv;
          if (rv > maxV) maxV = rv;
        }
        const area = (maxU - minU) * (maxV - minV);
        if (area < bestArea - 1e-12) {
          bestArea = area;
          best = r;
        }
      }
      const cs = Math.cos(best), sn = Math.sin(best);
      pts = pts.map(([u, v]) => [u * cs - v * sn, u * sn + v * cs]);
    }
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [u, v] of pts) {
      minU = Math.min(minU, u);
      minV = Math.min(minV, v);
      maxU = Math.max(maxU, u);
      maxV = Math.max(maxV, v);
    }
    // Lying down packs better on shelves.
    if (maxV - minV > maxU - minU) {
      pts = pts.map(([u, v]) => [v, -u]);
      [minU, maxU, minV, maxV] = [minV, maxV, -maxU, -minU];
    }
    boxes.push({ refs, pts: pts.map(([u, v]) => [u - minU, v - minV]), w: maxU - minU, h: maxV - minV, x: 0, y: 0 });
  }
  boxes.sort((a, b) => b.h - a.h || b.w - a.w);
  const shelf = (width: number, gap: number) => {
    let x = 0, y = 0, row = 0, used = 0;
    for (const b of boxes) {
      if (x > 0 && x + b.w > width) {
        y += row + gap;
        x = 0;
        row = 0;
      }
      b.x = x;
      b.y = y;
      x += b.w + gap;
      row = Math.max(row, b.h);
      used = Math.max(used, x - gap);
    }
    return Math.max(used, y + row);
  };
  const area = boxes.reduce((s, b) => s + b.w * b.h, 0);
  let side = Math.sqrt(area) || 1;
  let layout = { width: side, side };
  for (let pass = 0; pass < 3; pass += 1) {
    const gap = margin * side;
    let best = { width: 0, side: Infinity };
    const widest = Math.max(...boxes.map((b) => b.w));
    for (let f = 1; f <= 2.5; f += 0.05) {
      const width = Math.max(widest, Math.sqrt(area) * f);
      const s = shelf(width, gap);
      if (s < best.side) best = { width, side: s };
    }
    layout = best;
    side = best.side / (1 - 2 * margin);
  }
  const gap = margin * side;
  shelf(layout.width, gap);
  const offset = margin * side;
  for (const b of boxes) {
    b.refs.forEach(([f, c], i) => {
      uvs[f]![c * 2] = (b.pts[i]![0] + b.x + offset) / side;
      uvs[f]![c * 2 + 1] = (b.pts[i]![1] + b.y + offset) / side;
    });
  }
  return { ...p, uvs };
}

// ── editing and measuring ───────────────────────────────────────────────────

/** Apply `fn` to the UVs of every corner of `faces` (the UV editor's move, turn, flip and scale). */
export function transformUvs(p: Poly, faces: Set<number>, fn: (u: number, v: number) => [number, number]): Poly {
  if (!p.uvs) throw new UvError("This mesh has no UVs yet — unwrap it first.");
  const uvs = p.uvs.map((u, f) => {
    if (!faces.has(f)) return u;
    const out = u.slice();
    for (let i = 0; i < out.length; i += 2) {
      const [a, b] = fn(out[i]!, out[i + 1]!);
      out[i] = a;
      out[i + 1] = b;
    }
    return out;
  });
  return { ...p, uvs };
}

/** The centre of the UVs of `faces`. */
export function uvCenter(p: Poly, faces: Iterable<number>): [number, number] {
  let u = 0, v = 0, n = 0;
  for (const f of faces) {
    const uv = p.uvs?.[f];
    if (!uv) continue;
    for (let i = 0; i < uv.length; i += 2) {
      u += uv[i]!;
      v += uv[i + 1]!;
      n += 1;
    }
  }
  return n ? [u / n, v / n] : [0.5, 0.5];
}

export interface UvStats {
  islands: number;
  /** Texture pixels per metre of surface, for a square texture `size` pixels wide. */
  pixelsPerMetre(size: number): number;
  /** Share of the 0–1 square the UVs cover (overlaps counted twice). */
  coverage: number;
  /** Faces whose UVs run clockwise — mirrored in the texture. */
  flipped: number;
}

export function uvStats(p: Poly): UvStats {
  let a3 = 0;
  let auv = 0;
  let flipped = 0;
  p.faces.forEach((_, f) => {
    a3 += faceArea3(p, f);
    const a = faceAreaUv(p, f);
    auv += Math.abs(a);
    if (a < -1e-12) flipped += 1;
  });
  const density = a3 > 0 ? Math.sqrt(auv / a3) : 0;
  return { islands: p.uvs ? uvIslands(p).length : 0, pixelsPerMetre: (size) => density * size, coverage: auv, flipped };
}

/**
 * How stretched each face's UVs are against the mesh's average: log2 of its
 * UV-to-surface area ratio over the whole mesh's. 0 is even; +1 has twice the
 * texture it should, −1 half.
 */
export function faceStretch(p: Poly): Float32Array {
  const out = new Float32Array(p.faces.length);
  let a3 = 0;
  let auv = 0;
  const ratio = p.faces.map((_, f) => {
    const x = faceArea3(p, f);
    const y = Math.abs(faceAreaUv(p, f));
    a3 += x;
    auv += y;
    return x > 1e-18 ? y / x : 1;
  });
  const mean = a3 > 0 && auv > 0 ? auv / a3 : 1;
  ratio.forEach((r, f) => (out[f] = r > 0 ? Math.log2(r / mean) : -4));
  return out;
}

/** The conformal error of a layout: how far each triangle's UV angles are from its 3D angles, averaged in radians. */
export function angleDistortion(p: Poly): number {
  let sum = 0;
  let count = 0;
  p.faces.forEach((face, f) => {
    const tris = triangulateFace(p, face);
    for (let k = 0; k < tris.length; k += 3) {
      const c = [tris[k]!, tris[k + 1]!, tris[k + 2]!];
      const q = c.map((i) => at(p, face[i]!));
      const u = c.map((i) => cornerUv(p, f, i)!);
      if (!u[0] || triArea(q[0]!, q[1]!, q[2]!) < 1e-14) continue;
      for (let j = 0; j < 3; j += 1) {
        const a3 = angle3(q[j]!, q[(j + 1) % 3]!, q[(j + 2) % 3]!);
        const a2 = angle2(u[j]!, u[(j + 1) % 3]!, u[(j + 2) % 3]!);
        sum += Math.abs(a3 - a2);
        count += 1;
      }
    }
  });
  return count ? sum / count : 0;
}

function angle3(o: V3, a: V3, b: V3): number {
  const x = sub(a, o);
  const y = sub(b, o);
  return Math.acos(Math.max(-1, Math.min(1, dot(x, y) / (len(x) * len(y) || 1))));
}

function angle2(o: [number, number], a: [number, number], b: [number, number]): number {
  const x = [a[0] - o[0], a[1] - o[1]];
  const y = [b[0] - o[0], b[1] - o[1]];
  const l = Math.hypot(x[0]!, x[1]!) * Math.hypot(y[0]!, y[1]!) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (x[0]! * y[0]! + x[1]! * y[1]!) / l)));
}
