// ── Raster engine helpers ──────────────────────────────────────────────────
//
// MeroPixArt keeps pixels in PNG blobs and metadata in the contract. This module
// owns the browser-side pixel work: decoding/encoding blobs, building the CSS
// filter string for non-destructive adjustments, applying curves via a LUT,
// flood fill, blend-mode mapping, and flattening for export.

import type { Adjustments, BlendMode, Layer } from "../types";

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/** Encode a canvas to PNG bytes for blob upload. */
export function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("canvas.toBlob returned null"));
      blob.arrayBuffer().then(resolve, reject);
    }, "image/png");
  });
}

/** Decode raw image bytes (PNG/JPG/etc.) into an HTMLImageElement. */
export function bytesToImage(bytes: ArrayBuffer, mime = "image/png"): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── Non-destructive adjustments → CSS filter ────────────────────────────────
//
// brightness/contrast/saturation/hue/exposure/blur/invert map cleanly to the
// 2D context `filter` property (GPU-accelerated). Curves are applied separately
// via a LUT because the filter API can't express them.

export function adjustmentsToFilter(adj: Adjustments): string {
  const parts: string[] = [];
  // brightness + exposure both scale luminance; combine multiplicatively.
  const brightness = 1 + adj.brightness / 100 + adj.exposure / 100;
  if (Math.abs(brightness - 1) > 0.001) parts.push(`brightness(${clamp(brightness, 0, 4)})`);
  const contrast = 1 + adj.contrast / 100;
  if (Math.abs(contrast - 1) > 0.001) parts.push(`contrast(${clamp(contrast, 0, 4)})`);
  const saturate = 1 + adj.saturation / 100;
  if (Math.abs(saturate - 1) > 0.001) parts.push(`saturate(${clamp(saturate, 0, 4)})`);
  if (adj.hue) parts.push(`hue-rotate(${adj.hue}deg)`);
  if (adj.blur > 0) parts.push(`blur(${adj.blur}px)`);
  if (adj.invert) parts.push(`invert(1)`);
  return parts.length ? parts.join(" ") : "none";
}

export function hasFilterAdjustments(adj: Adjustments): boolean {
  return adjustmentsToFilter(adj) !== "none";
}

// ── Curves ──────────────────────────────────────────────────────────────────
//
// Curves are stored as JSON: { rgb?: Point[], r?: Point[], g?: Point[], b?: Point[] }
// where each Point is [x,y] in 0..255. We build a 256-entry LUT per channel via
// monotone linear interpolation between sorted control points and apply it to
// pixel data. Returns a NEW canvas (source untouched).

export interface CurvePoint { x: number; y: number; }
export interface CurvesData {
  rgb?: CurvePoint[];
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
}

export function parseCurves(json?: string): CurvesData | null {
  if (!json) return null;
  try {
    const data = JSON.parse(json) as CurvesData;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

export function isIdentityCurves(c: CurvesData | null): boolean {
  if (!c) return true;
  const ident = (pts?: CurvePoint[]) =>
    !pts || pts.length === 0 ||
    (pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 255 && pts[1].y === 255);
  return ident(c.rgb) && ident(c.r) && ident(c.g) && ident(c.b);
}

function buildLut(points?: CurvePoint[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  if (!points || points.length === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (pts[0].x > 0) pts.unshift({ x: 0, y: pts[0].y });
  if (pts[pts.length - 1].x < 255) pts.push({ x: 255, y: pts[pts.length - 1].y });
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    while (seg < pts.length - 2 && pts[seg + 1].x < i) seg++;
    const a = pts[seg];
    const b = pts[seg + 1];
    const t = b.x === a.x ? 0 : (i - a.x) / (b.x - a.x);
    lut[i] = Math.round(a.y + (b.y - a.y) * t);
  }
  return lut;
}

export function applyCurves(src: HTMLCanvasElement, curves: CurvesData): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height);
  const sctx = ctx2d(src);
  const octx = ctx2d(out);
  const imgData = sctx.getImageData(0, 0, src.width, src.height);
  const d = imgData.data;
  const rgb = buildLut(curves.rgb);
  const rl = buildLut(curves.r);
  const gl = buildLut(curves.g);
  const bl = buildLut(curves.b);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = rl[rgb[d[i]]];
    d[i + 1] = gl[rgb[d[i + 1]]];
    d[i + 2] = bl[rgb[d[i + 2]]];
  }
  octx.putImageData(imgData, 0, 0);
  return out;
}

// ── Levels ────────────────────────────────────────────────────────────────
//
// A Photoshop-style Levels adjustment: remap the input range
// [inBlack..inWhite] through a gamma curve onto the output range
// [outBlack..outWhite]. Baked via a 256-entry LUT. Returns a NEW canvas.

export interface LevelsData {
  inBlack: number;  // 0..255
  inWhite: number;  // 0..255
  gamma: number;    // 0.1..9.99 (1 = linear)
  outBlack: number; // 0..255
  outWhite: number; // 0..255
}

export const NEUTRAL_LEVELS: LevelsData = {
  inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255,
};

function buildLevelsLut(lv: LevelsData): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const inLo = clamp(lv.inBlack, 0, 254);
  const inHi = clamp(lv.inWhite, inLo + 1, 255);
  const g = clamp(lv.gamma, 0.1, 9.99);
  const span = inHi - inLo;
  for (let i = 0; i < 256; i++) {
    let t = clamp((i - inLo) / span, 0, 1);
    t = Math.pow(t, 1 / g);
    lut[i] = Math.round(lv.outBlack + t * (lv.outWhite - lv.outBlack));
  }
  return lut;
}

export function applyLevels(src: HTMLCanvasElement, lv: LevelsData): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height);
  const sctx = ctx2d(src);
  const octx = ctx2d(out);
  const img = sctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  const lut = buildLevelsLut(lv);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ── Flood fill (bucket) ─────────────────────────────────────────────────────

export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: [number, number, number, number],
  tolerance = 32,
  /** Optional in/out mask (length width*height, nonzero = fillable). Confines
   *  the fill to an active pixel selection — a ctx clip cannot, since the fill
   *  mutates ImageData directly. */
  mask?: Uint8Array,
): void {
  const { width, height } = ctx.canvas;
  startX = Math.floor(startX);
  startY = Math.floor(startY);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return;
  if (mask && !mask[startY * width + startX]) return;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const idx = (x: number, y: number) => (y * width + x) * 4;
  const target = [
    d[idx(startX, startY)],
    d[idx(startX, startY) + 1],
    d[idx(startX, startY) + 2],
    d[idx(startX, startY) + 3],
  ];
  const match = (i: number) =>
    Math.abs(d[i] - target[0]) <= tolerance &&
    Math.abs(d[i + 1] - target[1]) <= tolerance &&
    Math.abs(d[i + 2] - target[2]) <= tolerance &&
    Math.abs(d[i + 3] - target[3]) <= tolerance;
  const stack: Array<[number, number]> = [[startX, startY]];
  const seen = new Uint8Array(width * height);
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const p = y * width + x;
    if (seen[p]) continue;
    if (mask && !mask[p]) continue;
    const i = p * 4;
    if (!match(i)) continue;
    seen[p] = 1;
    d[i] = fillColor[0];
    d[i + 1] = fillColor[1];
    d[i + 2] = fillColor[2];
    d[i + 3] = fillColor[3];
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(img, 0, 0);
}

// ── Color utils ──────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ── Blend modes ──────────────────────────────────────────────────────────────

const BLEND_OP: Record<BlendMode, GlobalCompositeOperation> = {
  "normal": "source-over",
  "multiply": "multiply",
  "screen": "screen",
  "overlay": "overlay",
  "darken": "darken",
  "lighten": "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  "difference": "difference",
  "exclusion": "exclusion",
  "hue": "hue",
  "saturation": "saturation",
  "color": "color",
  "luminosity": "luminosity",
};

export function blendOp(mode: BlendMode): GlobalCompositeOperation {
  return BLEND_OP[mode] ?? "source-over";
}

// ── Text layer rendering ──────────────────────────────────────────────────────

export function renderTextLayer(layer: Layer): HTMLCanvasElement {
  const t = layer.text;
  const w = Math.max(1, layer.width);
  const h = Math.max(1, layer.height);
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  if (!t) return c;
  const style = `${t.italic ? "italic " : ""}${t.bold ? "700 " : "400 "}${t.fontSize}px ${t.fontFamily}, sans-serif`;
  ctx.font = style;
  ctx.fillStyle = t.color;
  ctx.textBaseline = "top";
  ctx.textAlign = (t.align as CanvasTextAlign) || "left";
  const x = t.align === "center" ? w / 2 : t.align === "right" ? w : 0;
  const lines = t.content.split("\n");
  const lineHeight = t.fontSize * 1.2;
  lines.forEach((line, i) => ctx.fillText(line, x, i * lineHeight));
  return c;
}
