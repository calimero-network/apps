// ── Layer compositor ───────────────────────────────────────────────────────
//
// Flattens the layer stack into a single document-resolution canvas, honouring
// folder nesting (inherited visibility/opacity), blend mode, opacity, layer
// mask, non-destructive filter adjustments, and per-layer transform.
//
// The same function powers the on-screen view (then blitted with zoom/pan) and
// PNG/JPG export — so what you see is exactly what you export.
//
// ── Why there is a cache ────────────────────────────────────────────────────
//
// This runs on every pointer move: a drag bumps `renderTick`, which redraws the
// canvas, which recomposites the whole document. Most of a layer's cost does not
// depend on where any other layer is, and a lot of it is brutal:
//
//   • a `blur` adjustment is a real gaussian pass over the layer — measured at
//     ~17ms per 1800×360 layer, and Sunset Ridge has two, which is why dragging
//     anything in that document used to cost ~49ms a frame;
//   • a layer mask is a per-pixel luminance→alpha conversion;
//   • a text layer re-measures and re-renders its glyphs;
//   • an unpainted fill layer regenerates a full-document solid.
//
// So each layer's pixels are prepared ONCE — masked and filtered — into a cached
// canvas keyed by a signature of everything that affects it, and the composite
// loop is then transform + alpha + blend + drawImage. Moving one layer re-prepares
// that layer; the other twenty-two are blits. Measured on the bundled showcases,
// dragging a layer went:
//
//   Sunset Ridge   46.6ms → 6.7ms      Bauhaus Grid    6.8ms → 5.2ms
//   Aurora Edition 10.8ms → 6.2ms      Transform Lab   2.5ms → 1.5ms
//
// The corner-pin warp is deliberately NOT baked — see `prepareLayer` for the
// measurement that decided it.
//
// Correctness rests on `layerPixelVersion`/`maskPixelVersion` from the canvas
// registry (see the "Pixel versions" note there): every path that mutates pixels
// goes through a `get*`, which bumps the counter, which changes the signature.

import type { Adjustments, Layer } from "../types";
import { adjustmentsToFilter, blendOp, createCanvas, ctx2d, renderTextLayer } from "./raster";
import { drawWarped, layerMatrix, parseWarp } from "./transform";
import {
  layerPixelVersion, maskPixelVersion, peekLayerCanvas, peekMaskCanvas,
} from "../store/layerCanvases";

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

/** Where a layer's pixels come from. Defaults to the editor's canvas registry;
 *  the showcase previews pass their own so they can render off to the side
 *  without registering anything. */
export type PixelSource = (layerId: string) => HTMLCanvasElement | null | undefined;

// Every canvas the compositor is handed gets a stable serial, so the prepared
// cache can tell "the same buffer, mutated" (version counter) from "a different
// buffer entirely". The registry's version counters cannot see the latter,
// because a caller may supply its own `sources` — the showcase previews do, and
// so does the test suite.
let nextCanvasSerial = 1;
const canvasSerials = new WeakMap<HTMLCanvasElement, number>();

function canvasSerial(canvas: HTMLCanvasElement): number {
  let serial = canvasSerials.get(canvas);
  if (serial === undefined) {
    serial = nextCanvasSerial++;
    canvasSerials.set(canvas, serial);
  }
  return serial;
}

/**
 * A reference to a layer's pixels: a token saying WHICH pixels they are, and a
 * getter that produces them.
 *
 * Lazy on purpose. A text layer and an unpainted fill layer generate their canvas
 * from the layer's own fields, and generating a full-document solid costs ~2ms —
 * so resolving eagerly would pay that on every composite even when the prepared
 * cache is about to hit. The token is enough to key the cache; the pixels are
 * only built on a miss.
 *
 * `gen` marks generated content: it is fully described by fields that are already
 * in the signature (text props, `fill`, width, height), so a fresh canvas object
 * each call must NOT invalidate the entry.
 */
interface LayerSourceRef {
  token: string;
  get: () => HTMLCanvasElement;
}

function sourceRef(layer: Layer, peek: PixelSource): LayerSourceRef | null {
  if (layer.kind === "group" || layer.kind === "adjustment") return null;
  if (layer.kind === "text") {
    return { token: "gen", get: () => renderTextLayer(layer) };
  }
  if (layer.kind === "fill") {
    // Once a fill layer has been painted on (brush/eraser/bucket-in-selection),
    // it carries a pixel buffer — prefer it so strokes are visible. Otherwise
    // it's still a procedural solid generated from `fill`.
    const painted = peek(layer.id);
    if (painted) return { token: `c${canvasSerial(painted)}`, get: () => painted };
    return {
      token: "gen",
      get: () => {
        const c = createCanvas(layer.width, layer.height);
        const ctx = ctx2d(c);
        ctx.fillStyle = layer.fill || "#000000";
        ctx.fillRect(0, 0, c.width, c.height);
        return c;
      },
    };
  }
  // raster / image
  const raster = peek(layer.id);
  return raster ? { token: `c${canvasSerial(raster)}`, get: () => raster } : null;
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

// ── Prepared-layer cache ────────────────────────────────────────────────────

interface Prepared {
  canvas: HTMLCanvasElement;
  /** Where to draw it in the layer's LOCAL space — a blur spills outside the
   *  layer box, so a blurred layer's prepared canvas is padded. */
  ox: number;
  oy: number;
  /** True when the corner-pin warp is already baked in, so the composite loop
   *  must NOT apply it again. See the note on `prepareLayer`. */
  warpBaked: boolean;
}

interface CacheEntry extends Prepared {
  sig: string;
}

const preparedCache = new Map<string, CacheEntry>();

/** Everything about a layer that changes its own pixels. Position, rotation,
 *  scale, shear, mirror, opacity and blend mode are deliberately ABSENT: those
 *  are applied by the composite loop, so moving a layer must not re-prepare it. */
function prepareSignature(layer: Layer, sourceToken: string, maskToken: string): string {
  const a = layer.adjustments;
  const adj = `${a.brightness},${a.contrast},${a.saturation},${a.hue},${a.exposure},${a.blur},${a.invert ? 1 : 0}`;
  const text = layer.text
    ? `${layer.text.content}|${layer.text.fontFamily}|${layer.text.fontSize}|${layer.text.color}`
      + `|${layer.text.bold ? 1 : 0}${layer.text.italic ? 1 : 0}|${layer.text.align ?? ""}`
    : "";
  return [
    layer.kind,
    layer.width, layer.height,
    sourceToken,
    layerPixelVersion(layer.id),
    maskToken,
    layer.warp ?? "",
    layer.fill ?? "",
    adj,
    text,
  ].join("~");
}

/**
 * A gaussian blur bleeds outside the source rectangle, so a layer with a blur
 * adjustment gets padding around it — otherwise baking into a tight canvas would
 * cut the blur off at the edges, which the un-cached path did not do.
 * Three sigma covers the visible tail.
 */
function blurPad(adjustments: Adjustments): number {
  return adjustments.blur > 0 ? Math.ceil(adjustments.blur * 3) : 0;
}

/**
 * Bake a layer's own pixels: mask → adjustments filter → warp, in local space.
 * Cached; only re-run when {@link prepareSignature} changes.
 */
function prepareLayer(
  layer: Layer, peek: PixelSource, peekMask: PixelSource,
): Prepared | null {
  const maskCanvas = layer.maskBlobId ? peekMask(layer.id) : undefined;
  // Which canvas it is belongs in the cache key, so the source is IDENTIFIED
  // first — but not built. See `sourceRef`: generating one can cost more than the
  // rest of the composite.
  const source = sourceRef(layer, peek);
  if (!source) return null;
  const maskToken = maskCanvas
    ? `m${canvasSerial(maskCanvas)}.${maskPixelVersion(layer.id)}`
    : "-";
  const sig = prepareSignature(layer, source.token, maskToken);
  const hit = preparedCache.get(layer.id);
  if (hit && hit.sig === sig) return hit;

  const src = source.get();

  // 1. mask (luminance → alpha), at the source's own resolution
  let img: HTMLCanvasElement = src;
  if (maskCanvas) {
    const masked = createCanvas(src.width, src.height);
    const mctx = ctx2d(masked);
    mctx.drawImage(src, 0, 0);
    mctx.globalCompositeOperation = "destination-in";
    mctx.drawImage(maskToAlpha(maskCanvas), 0, 0, masked.width, masked.height);
    img = masked;
  }

  // 2 + 3. adjustments filter and warp, into a padded local-space canvas
  // ── Whether to bake the warp ────────────────────────────────────────────
  //
  // Measured, not assumed. Baking a warp turns 288 clipped draws into one blit,
  // which is a 3–6× win for a SMALL layer — but for a large one that blit
  // resamples half a megapixel through the layer matrix every frame, and it goes
  // the other way badly (Aurora's 900×520 card: 15.0ms baked vs 6.4ms live, on a
  // document where the whole frame budget is 16ms).
  //
  // So the warp is normally left to the composite loop, exactly as it was before
  // this cache existed. The one exception is a layer that ALSO has a blur: its
  // prepared canvas is padded, and a padded canvas cannot be fed to `drawWarped`
  // (whose source rect must be the layer box), so that combination bakes.
  const warp = parseWarp(layer.warp);
  const pad = blurPad(layer.adjustments);
  const bakeWarp = warp !== null && pad > 0;
  const filter = adjustmentsToFilter(layer.adjustments);
  if (filter === "none" && pad === 0 && !bakeWarp) {
    // Nothing to bake — cache the source itself rather than copying it.
    const entry: CacheEntry = { sig, canvas: img, ox: 0, oy: 0, warpBaked: false };
    preparedCache.set(layer.id, entry);
    return entry;
  }

  // A warp can move corners outward, so measure the local extent it needs.
  let minX = 0, minY = 0, maxX = img.width, maxY = img.height;
  if (bakeWarp && warp) {
    for (const [dx, dy] of [warp.tl, warp.tr, warp.br, warp.bl]) {
      minX = Math.min(minX, dx);
      minY = Math.min(minY, dy);
      maxX = Math.max(maxX, img.width + dx);
      maxY = Math.max(maxY, img.height + dy);
    }
  }
  const ox = Math.floor(minX) - pad;
  const oy = Math.floor(minY) - pad;
  const out = createCanvas(Math.ceil(maxX) - ox + pad, Math.ceil(maxY) - oy + pad);
  const ctx = ctx2d(out);
  ctx.translate(-ox, -oy);
  ctx.filter = filter;
  if (bakeWarp && warp) drawWarped(ctx, img, img.width, img.height, warp);
  else ctx.drawImage(img, 0, 0);

  const entry: CacheEntry = { sig, canvas: out, ox, oy, warpBaked: bakeWarp };
  preparedCache.set(layer.id, entry);
  return entry;
}

/** Forget a layer's prepared pixels. Called when a layer goes away; the version
 *  counters handle every other case. */
export function invalidatePrepared(layerId?: string): void {
  if (layerId) preparedCache.delete(layerId);
  else preparedCache.clear();
}

/** Cached entry count — for tests and diagnostics. */
export function preparedCacheSize(): number {
  return preparedCache.size;
}

export interface CompositeOptions {
  /** draw the document background fill first (default true) */
  background?: string;
  /** skip a layer id (e.g. while dragging a live preview elsewhere) */
  skipId?: string;
  /** override where layer pixels come from (default: the editor's registry) */
  sources?: PixelSource;
  /** override where layer masks come from (default: the editor's registry) */
  masks?: PixelSource;
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
  const peek = opts.sources ?? peekLayerCanvas;
  const peekMask = opts.masks ?? peekMaskCanvas;

  if (opts.background && opts.background !== "#00000000") {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
  }

  // Prepared canvases are big (a padded, full-resolution copy per layer), so a
  // layer that has gone away must not keep one alive. Flattening and exporting
  // both pass the full layer list, so "not in this list" is a safe signal.
  if (preparedCache.size > layers.length) {
    const live = new Set(layers.map((l) => l.id));
    for (const id of [...preparedCache.keys()]) {
      if (!live.has(id)) preparedCache.delete(id);
    }
  }

  const ordered = [...layers].sort((a, b) => a.layerIndex - b.layerIndex);

  for (const layer of ordered) {
    if (opts.skipId === layer.id) continue;
    if (!effectiveVisible(layer, map)) continue;

    const alpha = effectiveOpacity(layer, map);
    if (alpha <= 0) continue;

    const prepared = prepareLayer(layer, peek, peekMask);
    if (!prepared) continue;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = blendOp(layer.blendMode);
    // Transform: one matrix for position / mirror / shear / scale / rotation
    // (see utils/transform — the gizmo and hit-testing read the same one). The
    // mask, the adjustments filter and the warp are already baked into
    // `prepared`, whose origin sits at (ox, oy) in the layer's local space.
    const m = layerMatrix(layer);
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    const warp = prepared.warpBaked ? null : parseWarp(layer.warp);
    if (warp) {
      // Same call the un-cached compositor made: the mesh maps the prepared
      // canvas's own rect onto the warped quad.
      drawWarped(ctx, prepared.canvas, prepared.canvas.width, prepared.canvas.height, warp);
    } else {
      ctx.drawImage(prepared.canvas, prepared.ox, prepared.oy);
    }
    ctx.restore();
  }

  return out;
}
