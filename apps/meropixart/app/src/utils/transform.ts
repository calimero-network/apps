// ── Layer transform algebra ──────────────────────────────────────────────────
//
// A layer's placement in the document is one affine matrix built from its
// position, scale, mirror, shear and rotation — plus an optional corner-pin
// warp, which is *not* affine and so is drawn as a subdivided triangle mesh on
// top of the affine part.
//
// Everything that needs to agree about where a layer's pixels land goes through
// this module: the compositor (draw), the canvas gizmo (handles), hit-testing
// and the pixel selection (docToLayerLocal). Keeping one definition is the whole
// point — before this, rotation was re-derived in three places with three
// slightly different centres.
//
// Order of operations, applied to a point in the layer's local pixel space:
//
//   1. centre it            (−w/2, −h/2)
//   2. mirror               flipH / flipV
//   3. shear                skewX (x += y·tan), skewY (y += x·tan)
//   4. scale                scaleX / scaleY percent
//   5. rotate               rotation degrees
//   6. translate            to the layer box centre in document space
//
// Shear before scale is what Photoshop does: the skew angle stays the angle you
// asked for regardless of a non-uniform scale.

import type { Layer, WarpCorners } from "../types";
import { NEUTRAL_WARP } from "../types";
import { createCanvas, ctx2d } from "./raster";

/** A 2D affine matrix, in the same field order as canvas `setTransform`. */
export interface Matrix2D {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

export const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `m` then `n` (i.e. n ∘ m — `m` is applied to the point first). */
export function multiply(m: Matrix2D, n: Matrix2D): Matrix2D {
  return {
    a: m.a * n.a + m.b * n.c,
    b: m.a * n.b + m.b * n.d,
    c: m.c * n.a + m.d * n.c,
    d: m.c * n.b + m.d * n.d,
    e: m.e * n.a + m.f * n.c + n.e,
    f: m.e * n.b + m.f * n.d + n.f,
  };
}

export function applyMatrix(m: Matrix2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Inverse of an affine matrix, or null when it is singular (zero scale). */
export function invert(m: Matrix2D): Matrix2D | null {
  const det = m.a * m.d - m.b * m.c;
  if (!det || !Number.isFinite(det)) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Scale factors as fractions (percent fields default to 100 when unset). */
export function scaleOf(layer: Pick<Layer, "scaleX" | "scaleY">): { sx: number; sy: number } {
  return { sx: (layer.scaleX || 100) / 100, sy: (layer.scaleY || 100) / 100 };
}

/** Shear tangents, clamped to the range the contract stores. */
function shearOf(layer: Pick<Layer, "skewX" | "skewY">): { tx: number; ty: number } {
  const clampDeg = (v: number) => Math.max(-80, Math.min(80, v || 0));
  return {
    tx: Math.tan((clampDeg(layer.skewX) * Math.PI) / 180),
    ty: Math.tan((clampDeg(layer.skewY) * Math.PI) / 180),
  };
}

/**
 * The size of a layer's *untransformed* box in document units — width/height
 * scaled, which is what the position (`x`,`y`) is the top-left of.
 */
export function boxSize(layer: Layer): { w: number; h: number } {
  const { sx, sy } = scaleOf(layer);
  return { w: layer.width * Math.abs(sx), h: layer.height * Math.abs(sy) };
}

/** The document-space centre a layer rotates/shears around. */
export function centerOf(layer: Layer): { cx: number; cy: number } {
  const { w, h } = boxSize(layer);
  return { cx: layer.x + w / 2, cy: layer.y + h / 2 };
}

/**
 * Layer-local pixels → document space, for everything except the warp.
 * Point (0,0) is the layer's top-left pixel; (width,height) its bottom-right.
 */
export function layerMatrix(layer: Layer): Matrix2D {
  const { sx, sy } = scaleOf(layer);
  const { tx, ty } = shearOf(layer);
  const { cx, cy } = centerOf(layer);
  const rad = ((layer.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mx = layer.flipH ? -1 : 1;
  const my = layer.flipV ? -1 : 1;

  // centre the local box
  let m: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: -layer.width / 2, f: -layer.height / 2 };
  // mirror
  m = multiply(m, { a: mx, b: 0, c: 0, d: my, e: 0, f: 0 });
  // shear
  m = multiply(m, { a: 1, b: ty, c: tx, d: 1, e: 0, f: 0 });
  // scale (sign already carried by the mirror step)
  m = multiply(m, { a: Math.abs(sx), b: 0, c: 0, d: Math.abs(sy), e: 0, f: 0 });
  // rotate
  m = multiply(m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  // place
  return multiply(m, { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy });
}

/** Document point → layer-local pixels. Falls back to the raw offset when the
 *  matrix is singular, so a zero-scale layer still hit-tests predictably. */
export function docToLocal(layer: Layer, dx: number, dy: number): { x: number; y: number } {
  const inv = invert(layerMatrix(layer));
  if (!inv) return { x: dx - layer.x, y: dy - layer.y };
  return applyMatrix(inv, dx, dy);
}

/** The layer's four corners in document space, top-left first, clockwise.
 *  Includes the warp displacement, so this is the outline the gizmo draws. */
export function cornersOf(layer: Layer): Array<{ x: number; y: number }> {
  const m = layerMatrix(layer);
  const w = parseWarp(layer.warp) ?? NEUTRAL_WARP;
  const local: Array<[number, number]> = [
    [0 + w.tl[0], 0 + w.tl[1]],
    [layer.width + w.tr[0], 0 + w.tr[1]],
    [layer.width + w.br[0], layer.height + w.br[1]],
    [0 + w.bl[0], layer.height + w.bl[1]],
  ];
  return local.map(([x, y]) => applyMatrix(m, x, y));
}

/** Axis-aligned bounding box of a layer, warp and rotation included. */
export function boundsOf(layer: Layer): { x: number; y: number; w: number; h: number } {
  const pts = cornersOf(layer);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Union bounding box of several layers (empty box when the list is empty). */
export function unionBounds(layers: Layer[]): { x: number; y: number; w: number; h: number } {
  if (layers.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of layers) {
    const b = boundsOf(l);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── Warp ─────────────────────────────────────────────────────────────────────

/** Parse a stored warp string. Returns null for absent/empty/garbage values and
 *  for an all-zero warp, so callers can treat "no warp" as one case. */
export function parseWarp(json?: string | null): WarpCorners | null {
  if (!json) return null;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const corner = (key: keyof WarpCorners): [number, number] => {
    const v = rec[key];
    if (!Array.isArray(v) || v.length < 2) return [0, 0];
    const x = Number(v[0]);
    const y = Number(v[1]);
    return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
  };
  const out: WarpCorners = { tl: corner("tl"), tr: corner("tr"), br: corner("br"), bl: corner("bl") };
  return isNeutralWarp(out) ? null : out;
}

export function isNeutralWarp(w: WarpCorners): boolean {
  return (["tl", "tr", "br", "bl"] as const).every((k) => w[k][0] === 0 && w[k][1] === 0);
}

/** Serialize a warp for the contract. A neutral warp encodes as "" (cleared). */
export function serializeWarp(w: WarpCorners): string {
  if (isNeutralWarp(w)) return "";
  const round = (p: [number, number]): [number, number] => [Math.round(p[0]), Math.round(p[1])];
  return JSON.stringify({ tl: round(w.tl), tr: round(w.tr), br: round(w.br), bl: round(w.bl) });
}

/** Read a layer's warp, always returning a usable object. */
export function warpOf(layer: Pick<Layer, "warp">): WarpCorners {
  return parseWarp(layer.warp) ?? { tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] };
}

/** Bilinear point inside the warped unit quad: (u,v) in 0..1 → local pixels. */
export function warpPoint(
  w: WarpCorners, width: number, height: number, u: number, v: number,
): { x: number; y: number } {
  const tl = { x: 0 + w.tl[0], y: 0 + w.tl[1] };
  const tr = { x: width + w.tr[0], y: 0 + w.tr[1] };
  const br = { x: width + w.br[0], y: height + w.br[1] };
  const bl = { x: 0 + w.bl[0], y: height + w.bl[1] };
  const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
  const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}

/** How finely the warp mesh is subdivided per axis. Higher = smoother curve at
 *  the cost of more draw calls; 12 is invisible from a normal zoom level. */
const WARP_STEPS = 12;

/**
 * Draw `img` into `ctx` bent onto a warped quad.
 *
 * Canvas 2D has no projective transform, so the quad is subdivided into a
 * WARP_STEPS² grid and each cell drawn as two triangles under the affine map
 * that carries its source triangle onto its destination triangle. The seams
 * between cells are hidden by expanding each clip triangle a hair (`BLEED`) —
 * without that, antialiasing along the shared edge leaves visible hairlines.
 *
 * `ctx` must already carry the layer's own affine transform: this function works
 * entirely in the layer's local pixel space.
 */
export function drawWarped(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  w: WarpCorners,
): void {
  const BLEED = 0.5;
  const n = WARP_STEPS;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const u0 = i / n, u1 = (i + 1) / n;
      const v0 = j / n, v1 = (j + 1) / n;
      // source cell (axis-aligned) and destination cell (warped)
      const s = [
        { x: u0 * srcWidth, y: v0 * srcHeight },
        { x: u1 * srcWidth, y: v0 * srcHeight },
        { x: u1 * srcWidth, y: v1 * srcHeight },
        { x: u0 * srcWidth, y: v1 * srcHeight },
      ];
      const d = [
        warpPoint(w, srcWidth, srcHeight, u0, v0),
        warpPoint(w, srcWidth, srcHeight, u1, v0),
        warpPoint(w, srcWidth, srcHeight, u1, v1),
        warpPoint(w, srcWidth, srcHeight, u0, v1),
      ];
      drawTriangle(ctx, img, [s[0], s[1], s[2]], [d[0], d[1], d[2]], BLEED);
      drawTriangle(ctx, img, [s[0], s[2], s[3]], [d[0], d[2], d[3]], BLEED);
    }
  }
}

type Pt = { x: number; y: number };

/** Draw the part of `img` inside source triangle `s` onto destination `d`. */
function drawTriangle(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource, s: Pt[], d: Pt[], bleed: number,
): void {
  const m = triangleMatrix(s, d);
  if (!m) return;
  ctx.save();
  ctx.beginPath();
  const grown = growTriangle(d, bleed);
  ctx.moveTo(grown[0].x, grown[0].y);
  ctx.lineTo(grown[1].x, grown[1].y);
  ctx.lineTo(grown[2].x, grown[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** The affine map taking source triangle `s` onto destination triangle `d`. */
export function triangleMatrix(s: Pt[], d: Pt[]): Matrix2D | null {
  const x1 = s[0].x, y1 = s[0].y, x2 = s[1].x, y2 = s[1].y, x3 = s[2].x, y3 = s[2].y;
  const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
  if (!det || !Number.isFinite(det)) return null; // degenerate source triangle
  const u1 = d[0].x, v1 = d[0].y, u2 = d[1].x, v2 = d[1].y, u3 = d[2].x, v3 = d[2].y;
  const a = ((u2 - u1) * (y3 - y1) - (u3 - u1) * (y2 - y1)) / det;
  const c = ((u3 - u1) * (x2 - x1) - (u2 - u1) * (x3 - x1)) / det;
  const b = ((v2 - v1) * (y3 - y1) - (v3 - v1) * (y2 - y1)) / det;
  const dd = ((v3 - v1) * (x2 - x1) - (v2 - v1) * (x3 - x1)) / det;
  return { a, b, c, d: dd, e: u1 - a * x1 - c * y1, f: v1 - b * x1 - dd * y1 };
}

/** Push each vertex out from the triangle's centroid by `amount` px. */
function growTriangle(t: Pt[], amount: number): Pt[] {
  const cx = (t[0].x + t[1].x + t[2].x) / 3;
  const cy = (t[0].y + t[1].y + t[2].y) / 3;
  return t.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
  });
}

/**
 * Bake a layer's transform into fresh pixels: render the layer through its own
 * matrix + warp into a canvas sized to its document bounds.
 *
 * Used by "Apply transform" — it turns a stack of live transform params into a
 * plain axis-aligned raster layer, which is the only way a rotated/warped layer
 * can be painted on with the brush in local space and still look right.
 * Returns the canvas plus the document position it should sit at.
 */
export function bakeTransform(
  layer: Layer, src: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; x: number; y: number } {
  const b = boundsOf(layer);
  const w = Math.max(1, Math.ceil(b.w));
  const h = Math.max(1, Math.ceil(b.h));
  const out = createCanvas(w, h);
  const ctx = ctx2d(out);
  const m = layerMatrix(layer);
  ctx.save();
  // shift so the layer's document bounds start at (0,0) of the new canvas
  ctx.translate(-b.x, -b.y);
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  const warp = parseWarp(layer.warp);
  if (warp) drawWarped(ctx, src, src.width, src.height, warp);
  else ctx.drawImage(src, 0, 0);
  ctx.restore();
  return { canvas: out, x: Math.round(b.x), y: Math.round(b.y) };
}
