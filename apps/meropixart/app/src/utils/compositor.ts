// ── Layer compositor ───────────────────────────────────────────────────────
//
// Flattens the layer stack into a single document-resolution canvas, honouring
// folder nesting (inherited visibility/opacity), blend mode, opacity, layer
// mask, non-destructive filter adjustments, and per-layer transform.
//
// The same function powers the on-screen view (then blitted with zoom/pan) and
// PNG/JPG export — so what you see is exactly what you export.

import type { Layer } from "../types";
import { adjustmentsToFilter, blendOp, createCanvas, ctx2d, renderTextLayer } from "./raster";
import { peekLayerCanvas, peekMaskCanvas } from "../store/layerCanvases";

function byId(layers: Layer[]): Map<string, Layer> {
  return new Map(layers.map((l) => [l.id, l]));
}

/** A layer is visible only if it and every ancestor group are visible. */
function effectiveVisible(layer: Layer, map: Map<string, Layer>): boolean {
  let cur: Layer | undefined = layer;
  const seen = new Set<string>();
  while (cur) {
    if (!cur.visible) return false;
    if (!cur.parentId || seen.has(cur.id)) break;
    seen.add(cur.id);
    cur = map.get(cur.parentId);
  }
  return true;
}

/** Opacity multiplied down the ancestor chain (0..1). */
function effectiveOpacity(layer: Layer, map: Map<string, Layer>): number {
  let o = layer.opacity / 100;
  let cur = layer.parentId ? map.get(layer.parentId) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    o *= cur.opacity / 100;
    seen.add(cur.id);
    cur = cur.parentId ? map.get(cur.parentId) : undefined;
  }
  return o;
}

/** The pixel source for a layer (raster/image canvas, rendered text, or fill). */
function sourceFor(layer: Layer): HTMLCanvasElement | null {
  if (layer.kind === "group" || layer.kind === "adjustment") return null;
  if (layer.kind === "text") return renderTextLayer(layer);
  if (layer.kind === "fill") {
    const c = createCanvas(layer.width, layer.height);
    const ctx = ctx2d(c);
    ctx.fillStyle = layer.fill || "#000000";
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }
  // raster / image
  return peekLayerCanvas(layer.id) ?? null;
}

/** Convert a grayscale mask canvas to an alpha mask (alpha = luminance). */
function maskToAlpha(mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = createCanvas(mask.width, mask.height);
  const mctx = ctx2d(mask);
  const octx = ctx2d(out);
  const img = mctx.getImageData(0, 0, mask.width, mask.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = lum;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

export interface CompositeOptions {
  /** draw the document background fill first (default true) */
  background?: string;
  /** skip a layer id (e.g. while dragging a live preview elsewhere) */
  skipId?: string;
}

export function composite(
  layers: Layer[],
  width: number,
  height: number,
  opts: CompositeOptions = {},
): HTMLCanvasElement {
  const out = createCanvas(width, height);
  const ctx = ctx2d(out);
  const map = byId(layers);

  if (opts.background && opts.background !== "#00000000") {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
  }

  const ordered = [...layers].sort((a, b) => a.layerIndex - b.layerIndex);

  for (const layer of ordered) {
    if (opts.skipId === layer.id) continue;
    if (!effectiveVisible(layer, map)) continue;
    const src = sourceFor(layer);
    if (!src) continue;

    const alpha = effectiveOpacity(layer, map);
    if (alpha <= 0) continue;

    // Build the (optionally masked) layer image at its own resolution.
    let img: HTMLCanvasElement = src;
    const maskCanvas = layer.maskBlobId ? peekMaskCanvas(layer.id) : undefined;
    if (maskCanvas) {
      const masked = createCanvas(src.width, src.height);
      const mctx = ctx2d(masked);
      mctx.drawImage(src, 0, 0);
      mctx.globalCompositeOperation = "destination-in";
      const alphaMask = maskToAlpha(maskCanvas);
      mctx.drawImage(alphaMask, 0, 0, masked.width, masked.height);
      img = masked;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = blendOp(layer.blendMode);
    ctx.filter = adjustmentsToFilter(layer.adjustments);

    // transform: position at (x,y), rotate around the layer centre, scale.
    const sx = (layer.scaleX || 100) / 100;
    const sy = (layer.scaleY || 100) / 100;
    const cx = layer.x + (img.width * sx) / 2;
    const cy = layer.y + (img.height * sy) / 2;
    ctx.translate(cx, cy);
    if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }

  return out;
}
