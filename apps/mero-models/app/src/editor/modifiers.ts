import {
  Build,
  add,
  at,
  cornerUv,
  edgeEnds,
  edgeKey,
  faceCenter,
  faceNormalRaw,
  lerp3,
  norm,
  scale,
  topology,
  vertexTotal,
  withModifiers,
  type Axis,
  type Modifier,
  type Poly,
  type V3,
} from "./poly";

/**
 * The modifier stack: non-destructive operations evaluated on top of the cage,
 * in order, every time it is drawn or exported. The cage stays what the
 * artist edits; the stack is saved with it in the mesh blob, so it is
 * versioned, synced and restored with the mesh.
 */

/** A stack that would grow past this many face corners stops before the modifier that would do it. */
export const MAX_EVALUATED_CORNERS = 4_000_000;

export const MODIFIER_LABELS: Record<Modifier["type"], string> = {
  mirror: "Mirror",
  subdivision: "Subdivision surface",
  array: "Array",
  solidify: "Solidify",
};

export function defaultModifier(type: Modifier["type"]): Modifier {
  switch (type) {
    case "mirror":
      return { type, axis: 0, weld: 0.001, on: true };
    case "subdivision":
      return { type, levels: 2, on: true };
    case "array":
      return { type, count: 3, offset: [1.2, 0, 0], on: true };
    case "solidify":
      return { type, thickness: 0.05, on: true };
  }
}

const finite = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;

/**
 * A modifier read from a blob or a form, checked field by field. Anything out
 * of range is refused rather than clamped: a blob claiming 40 subdivision
 * levels is not a mesh to draw.
 */
export function parseModifier(raw: unknown): Modifier | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const on = m.on !== false;
  switch (m.type) {
    case "mirror":
      if ((m.axis === 0 || m.axis === 1 || m.axis === 2) && finite(m.weld, 0, 1)) return { type: "mirror", axis: m.axis, weld: m.weld, on };
      return null;
    case "subdivision":
      if (finite(m.levels, 1, 4) && Number.isInteger(m.levels)) return { type: "subdivision", levels: m.levels, on };
      return null;
    case "array": {
      const o = m.offset;
      if (finite(m.count, 1, 64) && Number.isInteger(m.count) && Array.isArray(o) && o.length === 3 && o.every((x) => finite(x, -1000, 1000))) {
        return { type: "array", count: m.count, offset: [o[0], o[1], o[2]] as [number, number, number], on };
      }
      return null;
    }
    case "solidify":
      if (finite(m.thickness, -10, 10)) return { type: "solidify", thickness: m.thickness, on };
      return null;
    default:
      return null;
  }
}

/** The same modifier with its keys in a fixed order, so equal stacks serialise to equal bytes. */
export function canonicalModifier(m: Modifier): Modifier {
  switch (m.type) {
    case "mirror":
      return { type: m.type, axis: m.axis, weld: m.weld, on: m.on };
    case "subdivision":
      return { type: m.type, levels: m.levels, on: m.on };
    case "array":
      return { type: m.type, count: m.count, offset: [m.offset[0], m.offset[1], m.offset[2]], on: m.on };
    case "solidify":
      return { type: m.type, thickness: m.thickness, on: m.on };
  }
}

function predictCorners(corners: number, m: Modifier): number {
  switch (m.type) {
    case "mirror":
      return corners * 2;
    case "subdivision":
      return corners * 4 ** m.levels;
    case "array":
      return corners * m.count;
    case "solidify":
      return corners * 3;
  }
}

export function applyModifier(p: Poly, m: Modifier): Poly {
  switch (m.type) {
    case "mirror":
      return mirrorPoly(p, m.axis, m.weld);
    case "subdivision": {
      let out = p;
      for (let i = 0; i < m.levels; i += 1) out = catmullClark(out, true);
      return out;
    }
    case "array":
      return arrayPoly(p, m.count, m.offset);
    case "solidify":
      return solidifyPoly(p, m.thickness);
  }
}

/** The cage with its stack applied, and the labels of any modifier that had to be skipped. */
export function evaluate(p: Poly): { poly: Poly; skipped: string[] } {
  let cur = withModifiers(p, []);
  const skipped: string[] = [];
  for (const m of p.modifiers) {
    if (!m.on) continue;
    const corners = cur.faces.reduce((n, f) => n + f.length, 0);
    if (predictCorners(corners, m) > MAX_EVALUATED_CORNERS) {
      skipped.push(MODIFIER_LABELS[m.type]);
      continue;
    }
    cur = withModifiers(applyModifier(cur, m), []);
  }
  return { poly: cur, skipped };
}

// ── Subdivision surface ─────────────────────────────────────────────────────

/**
 * One level of Catmull–Clark subdivision: every face becomes quads, one per
 * corner. Sharp edges and open borders act as creases, so a hard-surface
 * cage keeps its silhouette edges while everything else rounds off — the
 * usual sub-d workflow. With `smooth` off it is a plain linear subdivide.
 *
 * Original vertices keep their indices; edge points follow, then face points.
 */
export function catmullClark(p: Poly, smooth = true): Poly {
  const V = vertexTotal(p);
  const t = topology(p);
  const edges = [...t.edgeFaces.keys()];
  const edgeIndex = new Map<number, number>();
  edges.forEach((k, i) => edgeIndex.set(k, V + i));
  const F0 = V + edges.length;
  const positions = new Array<number>((F0 + p.faces.length) * 3).fill(0);
  const put = (i: number, v: V3) => {
    positions[i * 3] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
  };
  const fp = p.faces.map((f) => faceCenter(p, f));
  fp.forEach((c, i) => put(F0 + i, c));
  const crease = (k: number) => p.sharp.has(k) || t.edgeFaces.get(k)!.length !== 2;
  edges.forEach((k, i) => {
    const [a, b] = edgeEnds(k);
    const pa = at(p, a);
    const pb = at(p, b);
    if (!smooth || crease(k)) put(V + i, lerp3(pa, pb, 0.5));
    else {
      const [f1, f2] = t.edgeFaces.get(k)!;
      put(V + i, scale(add(add(pa, pb), add(fp[f1!]!, fp[f2!]!)), 0.25));
    }
  });
  for (let v = 0; v < V; v += 1) {
    const pv = at(p, v);
    const nb = t.neighbours[v]!;
    if (!smooth || nb.length === 0) {
      put(v, pv);
      continue;
    }
    const creased = nb.filter((u) => crease(edgeKey(v, u)));
    if (creased.length >= 3) put(v, pv);
    else if (creased.length === 2) {
      put(v, scale(add(add(scale(pv, 6), at(p, creased[0]!)), at(p, creased[1]!)), 1 / 8));
    } else {
      const n = nb.length;
      const faces = [...new Set(t.vertexFaces[v]!)];
      let q: V3 = [0, 0, 0];
      for (const f of faces) q = add(q, fp[f]!);
      q = scale(q, 1 / faces.length);
      let r: V3 = [0, 0, 0];
      for (const u of nb) r = add(r, lerp3(pv, at(p, u), 0.5));
      r = scale(r, 1 / n);
      put(v, scale(add(add(q, scale(r, 2)), scale(pv, n - 3)), 1 / n));
    }
  }
  const faces: number[][] = [];
  const uvs: number[][] | null = p.uvs ? [] : null;
  p.faces.forEach((f, fi) => {
    const n = f.length;
    let cu = 0;
    let cv = 0;
    if (uvs) {
      for (let c = 0; c < n; c += 1) {
        cu += p.uvs![fi]![c * 2]!;
        cv += p.uvs![fi]![c * 2 + 1]!;
      }
      cu /= n;
      cv /= n;
    }
    for (let c = 0; c < n; c += 1) {
      const v = f[c]!;
      const next = f[(c + 1) % n]!;
      const prev = f[(c - 1 + n) % n]!;
      faces.push([v, edgeIndex.get(edgeKey(v, next))!, F0 + fi, edgeIndex.get(edgeKey(prev, v))!]);
      if (uvs) {
        const u0 = cornerUv(p, fi, c)!;
        const u1 = cornerUv(p, fi, c + 1)!;
        const um = cornerUv(p, fi, c - 1)!;
        uvs.push([u0[0], u0[1], (u0[0] + u1[0]) / 2, (u0[1] + u1[1]) / 2, cu, cv, (u0[0] + um[0]) / 2, (u0[1] + um[1]) / 2]);
      }
    }
  });
  // A marked edge is two edges now, both marked.
  const halves = (marks: Set<number>) => {
    const out = new Set<number>();
    for (const k of marks) {
      const e = edgeIndex.get(k);
      if (e === undefined) continue;
      const [a, b] = edgeEnds(k);
      out.add(edgeKey(a, e)).add(edgeKey(e, b));
    }
    return out;
  };
  return { positions, faces, uvs, sharp: halves(p.sharp), seams: halves(p.seams), modifiers: p.modifiers };
}

// ── Mirror ──────────────────────────────────────────────────────────────────

/**
 * The cage plus its reflection across the object's own plane on `axis`.
 * Vertices within `weld` of the plane are snapped onto it and shared by both
 * halves, so the seam is closed.
 */
export function mirrorPoly(p: Poly, axis: Axis, weld: number, keep = true): Poly {
  const V = vertexTotal(p);
  const b = new Build(p);
  const partner = new Int32Array(V);
  for (let v = 0; v < V; v += 1) {
    const x = p.positions[v * 3 + axis]!;
    if (Math.abs(x) <= weld) {
      partner[v] = v;
      b.positions[v * 3 + axis] = 0;
    } else {
      const m = at(p, v);
      m[axis] = -m[axis];
      partner[v] = b.vert(m);
    }
  }
  p.faces.forEach((f, fi) => {
    if (keep) b.face(f, p.uvs?.[fi]);
    if (f.every((v) => partner[v] === v)) return; // on the plane: its mirror is itself
    const order = [0, ...Array.from({ length: f.length - 1 }, (_, i) => f.length - 1 - i)];
    const uv = p.uvs?.[fi];
    b.face(
      order.map((c) => partner[f[c]!]!),
      uv ? order.flatMap((c) => [uv[c * 2]!, uv[c * 2 + 1]!]) : null,
    );
  });
  for (const k of p.sharp) {
    const [x, y] = edgeEnds(k);
    if (x < V && y < V) b.sharp.add(edgeKey(partner[x]!, partner[y]!));
  }
  for (const k of p.seams) {
    const [x, y] = edgeEnds(k);
    if (x < V && y < V) b.seams.add(edgeKey(partner[x]!, partner[y]!));
  }
  return b.done(p.modifiers);
}

// ── Array ───────────────────────────────────────────────────────────────────

/** `count` copies (the original included), each `offset` further along. */
export function arrayPoly(p: Poly, count: number, offset: [number, number, number]): Poly {
  const V = vertexTotal(p);
  const positions: number[] = [];
  const faces: number[][] = [];
  const uvs: number[][] | null = p.uvs ? [] : null;
  const sharp = new Set<number>();
  const seams = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    for (let v = 0; v < V; v += 1) {
      positions.push(
        p.positions[v * 3]! + offset[0] * i,
        p.positions[v * 3 + 1]! + offset[1] * i,
        p.positions[v * 3 + 2]! + offset[2] * i,
      );
    }
    const base = i * V;
    p.faces.forEach((f, fi) => {
      faces.push(f.map((v) => v + base));
      if (uvs) uvs.push(p.uvs![fi]!.slice());
    });
    for (const k of p.sharp) {
      const [a, b] = edgeEnds(k);
      sharp.add(edgeKey(a + base, b + base));
    }
    for (const k of p.seams) {
      const [a, b] = edgeEnds(k);
      seams.add(edgeKey(a + base, b + base));
    }
  }
  return { positions, faces, uvs, sharp, seams, modifiers: p.modifiers };
}

// ── Solidify ────────────────────────────────────────────────────────────────

/**
 * Give a surface thickness: an inner copy pushed back along the vertex
 * normals, turned inside out, and a rim closing every open border.
 */
export function solidifyPoly(p: Poly, thickness: number): Poly {
  const V = vertexTotal(p);
  const t = topology(p);
  const normals: V3[] = Array.from({ length: V }, () => [0, 0, 0] as V3);
  for (const f of p.faces) {
    const n = faceNormalRaw(p, f);
    for (const v of f) normals[v] = add(normals[v]!, n);
  }
  const b = new Build(p);
  const inner = new Int32Array(V);
  for (let v = 0; v < V; v += 1) inner[v] = b.vert(add(at(p, v), scale(norm(normals[v]!), -thickness)));
  p.faces.forEach((f, fi) => {
    b.face(f, p.uvs?.[fi]);
    const order = [0, ...Array.from({ length: f.length - 1 }, (_, i) => f.length - 1 - i)];
    const uv = p.uvs?.[fi];
    b.face(
      order.map((c) => inner[f[c]!]!),
      uv ? order.flatMap((c) => [uv[c * 2]!, uv[c * 2 + 1]!]) : null,
    );
  });
  for (const k of p.sharp) {
    const [x, y] = edgeEnds(k);
    b.sharp.add(edgeKey(inner[x]!, inner[y]!));
  }
  for (const k of p.seams) {
    const [x, y] = edgeEnds(k);
    b.seams.add(edgeKey(inner[x]!, inner[y]!));
  }
  // Every directed edge whose face is the only one on that edge is a border.
  for (const [key, faces] of t.edgeFaces) {
    if (faces.length !== 1) continue;
    const f = faces[0]!;
    const face = p.faces[f]!;
    const [x, y] = edgeEnds(key);
    const c = face.indexOf(x);
    const [a, bb] = face[(c + 1) % face.length] === y ? [x, y] : [y, x];
    const ca = face.indexOf(a);
    const cb = face.indexOf(bb);
    const ua = cornerUv(p, f, ca);
    const ub = cornerUv(p, f, cb);
    b.face([bb, a, inner[a]!, inner[bb]!], ua && ub ? [...ub, ...ua, ...ua, ...ub] : null);
    b.sharp.add(edgeKey(a, bb)).add(edgeKey(inner[a]!, inner[bb]!));
  }
  return b.done(p.modifiers);
}
