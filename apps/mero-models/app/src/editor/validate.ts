import type { TextureRef } from "../generated/MeroModelsClient";
import type { MeshShape } from "./geometry";
import type { SceneObject } from "./model";

/**
 * The checks a game asset has to pass before it goes to an engine: a
 * triangle and texture budget, and the problems that only show up after
 * import — missing or overlapping UVs, mirrored UVs, unapplied scale,
 * non-manifold edges, n-gons, oversized or non-power-of-two textures.
 */

export type Severity = "error" | "warning" | "info";

export interface Check {
  severity: Severity;
  /** The object the check is about, if one. */
  object?: string;
  text: string;
}

export interface Budget {
  key: string;
  name: string;
  /** Triangles across the whole asset at LOD 0. */
  triangles: number;
  /** Largest side a texture should have. */
  textureSize: number;
  /** Texture memory across the asset, MiB, with mipmaps, block-compressed (BC7, a byte a texel) as engines ship it. */
  textureMemory: number;
}

export const BUDGETS: Budget[] = [
  { key: "hero", name: "Hero prop · PC/console", triangles: 25_000, textureSize: 4096, textureMemory: 64 },
  { key: "prop", name: "Prop · PC/console", triangles: 6_000, textureSize: 2048, textureMemory: 16 },
  { key: "background", name: "Background prop", triangles: 1_500, textureSize: 1024, textureMemory: 4 },
  { key: "mobile", name: "Mobile prop", triangles: 1_000, textureSize: 512, textureMemory: 1 },
];

export interface AssetPart {
  object: SceneObject;
  shape: MeshShape;
  /** Faces with more than four corners in the cage, if it has one. */
  ngons: number;
  /** The object's world scale. */
  worldScale: [number, number, number];
}

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

/** Overlap, flips and range of a shape's UVs, rasterised coarsely. */
export function uvHealth(shape: MeshShape, size = 128): { overlap: number; flipped: number; outside: number; degenerate: number } {
  const uv = shape.uvs!;
  const claims = new Uint8Array(size * size);
  let covered = 0;
  let doubled = 0;
  let flipped = 0;
  let outside = 0;
  let degenerate = 0;
  const P = shape.positions;
  for (let t = 0; t < shape.indices.length; t += 3) {
    const [a, b, c] = [shape.indices[t]!, shape.indices[t + 1]!, shape.indices[t + 2]!];
    const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-12) degenerate += 1;
    const ax = uv[a * 2]!, ay = uv[a * 2 + 1]!, bx = uv[b * 2]!, by = uv[b * 2 + 1]!, cx = uv[c * 2]!, cy = uv[c * 2 + 1]!;
    for (const x of [ax, ay, bx, by, cx, cy]) if (x < -1e-4 || x > 1 + 1e-4) outside += 1;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area < -1e-12) flipped += 1;
    if (Math.abs(area) < 1e-14) continue;
    const X = (u: number) => u * size;
    const Y = (v: number) => (1 - v) * size;
    const pts = [[X(ax), Y(ay)], [X(bx), Y(by)], [X(cx), Y(cy)]] as const;
    const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), maxX = Math.min(size - 1, Math.ceil(Math.max(...pts.map((p) => p[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), maxY = Math.min(size - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))));
    const [p0, p1, p2] = pts;
    const d = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5, py = y + 0.5;
        const w1 = ((px - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (py - p0[1])) / d;
        const w2 = ((p1[0] - p0[0]) * (py - p0[1]) - (px - p0[0]) * (p1[1] - p0[1])) / d;
        if (w1 <= 1e-4 || w2 <= 1e-4 || 1 - w1 - w2 <= 1e-4) continue;
        const k = y * size + x;
        if (claims[k] === 0) covered += 1;
        else if (claims[k] === 1) doubled += 1;
        if (claims[k]! < 2) claims[k] = claims[k]! + 1;
      }
    }
  }
  return { overlap: covered ? doubled / covered : 0, flipped, outside, degenerate };
}

/** Edges (welded by position) used by more than two triangles, and by one. */
export function edgeHealth(shape: MeshShape): { nonManifold: number; open: number } {
  const key = (i: number) => `${shape.positions[i * 3]},${shape.positions[i * 3 + 1]},${shape.positions[i * 3 + 2]}`;
  const use = new Map<string, number>();
  for (let t = 0; t < shape.indices.length; t += 3) {
    for (let j = 0; j < 3; j += 1) {
      const a = key(shape.indices[t + j]!);
      const b = key(shape.indices[t + ((j + 1) % 3)]!);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      use.set(k, (use.get(k) ?? 0) + 1);
    }
  }
  let nonManifold = 0;
  let open = 0;
  for (const n of use.values()) {
    if (n > 2) nonManifold += 1;
    if (n === 1) open += 1;
  }
  return { nonManifold, open };
}

export function validateAsset(parts: AssetPart[], textures: TextureRef[], budget: Budget): Check[] {
  const checks: Check[] = [];
  const triangles = parts.reduce((n, p) => n + p.shape.indices.length / 3, 0);
  checks.push({
    severity: triangles > budget.triangles ? "error" : "info",
    text: `${triangles.toLocaleString()} triangles at LOD 0, of a ${budget.triangles.toLocaleString()} budget.`,
  });
  checks.push({ severity: "info", text: `${parts.length} mesh${parts.length === 1 ? "" : "es"}: ${parts.length} draw call${parts.length === 1 ? "" : "s"} at least.` });
  for (const p of parts) {
    const name = p.object.name;
    if (!p.shape.uvs) checks.push({ severity: "error", object: name, text: "No UVs: textures cannot land on it. Unwrap it (U) or smart project it." });
    else {
      const uv = uvHealth(p.shape);
      if (uv.overlap > 0.02) checks.push({ severity: "warning", object: name, text: `${Math.round(uv.overlap * 100)}% of its UV area overlaps: baked lighting and unique texturing will clash. Pack islands.` });
      if (uv.flipped) checks.push({ severity: "warning", object: name, text: `${uv.flipped} triangles have mirrored UVs: normal maps light them backwards.` });
      if (uv.outside) checks.push({ severity: "warning", object: name, text: "UVs reach outside the 0–1 square: fine for tiling, wrong for a unique texture." });
      if (uv.degenerate) checks.push({ severity: "warning", object: name, text: `${uv.degenerate} zero-area triangles: merge by distance.` });
    }
    const edges = edgeHealth(p.shape);
    if (edges.nonManifold) checks.push({ severity: "warning", object: name, text: `${edges.nonManifold} edges are shared by more than two faces: physics and lightmap bakers may reject it.` });
    if (edges.open) checks.push({ severity: "info", object: name, text: `${edges.open} open border edges: fine for a card or a decal, a hole otherwise.` });
    if (p.ngons) checks.push({ severity: "info", object: name, text: `${p.ngons} n-gons: exported as triangles, but check the shading where they fold.` });
    const [sx, sy, sz] = p.worldScale;
    if (sx < 0 || sy < 0 || sz < 0) checks.push({ severity: "warning", object: name, text: "Mirrored by a negative scale: apply transforms (Ctrl+A) so normals and collision agree." });
    else if ([sx, sy, sz].some((s) => Math.abs(s - 1) > 1e-3)) checks.push({ severity: "warning", object: name, text: `Scaled ${[sx, sy, sz].map((s) => +s.toFixed(3)).join(" × ")}: apply transforms (Ctrl+A) so it imports at size 1.` });
    const m = p.object.material;
    if (!m.base_color_map && !m.normal_map && !m.orm_map) checks.push({ severity: "info", object: name, text: "No textures: it exports with a flat colour. Bake & texture it for PBR maps." });
  }
  let memory = 0;
  for (const t of textures) {
    memory += (t.width * t.height * 4) / 3;
    if (Math.max(t.width, t.height) > budget.textureSize) {
      checks.push({ severity: "warning", text: `${t.name} is ${t.width}×${t.height}, over the ${budget.textureSize}² this budget allows.` });
    }
    if (!isPow2(t.width) || !isPow2(t.height)) checks.push({ severity: "warning", text: `${t.name} is ${t.width}×${t.height}: not a power of two, so engines cannot mipmap or compress it well.` });
  }
  const mib = memory / (1024 * 1024);
  checks.push({
    severity: mib > budget.textureMemory ? "error" : "info",
    text: `${textures.length} texture${textures.length === 1 ? "" : "s"}, ${mib.toFixed(1)} MiB with mipmaps once block-compressed (BC7), of ${budget.textureMemory} MiB.`,
  });
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return checks.sort((a, b) => order[a.severity] - order[b.severity]);
}
