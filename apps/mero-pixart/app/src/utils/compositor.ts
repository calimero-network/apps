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
  isLayerBlank, layerPixelVersion, maskPixelVersion, peekLayerCanvas, peekMaskCanvas,
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
  /** The {@link prepareSignature} these pixels were built from. */
  sig: string;
  canvas: HTMLCanvasElement;
  /** Where to draw it in the layer's LOCAL space — a blur spills outside the
   *  layer box, so a blurred layer's prepared canvas is padded. */
  ox: number;
  oy: number;
  /** True when the corner-pin warp is already baked in, so the composite loop
   *  must NOT apply it again. See the note on `prepareLayer`. */
  warpBaked: boolean;
}

type CacheEntry = Prepared;

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

/** One layer, ready to draw: its prepared pixels plus how to place them. */
interface DrawOp {
  layer: Layer;
  prepared: Prepared;
  alpha: number;
  op: GlobalCompositeOperation;
  /** Everything that decides what this op paints — prepared pixels, transform,
   *  alpha, blend. Two ops with equal keys draw identical pixels. */
  key: string;
}

/**
 * The layer stack as the flat, bottom-to-top list of draws the composite makes.
 *
 * Folders are not isolated (a folder only contributes inherited visibility and
 * opacity, see `effectiveVisible`/`effectiveOpacity`), so the composite is
 * exactly "run these draws in order" — which is what lets {@link StackCompositor}
 * cache a prefix and a suffix of it.
 */
function drawOps(layers: Layer[], opts: CompositeOptions): DrawOp[] {
  const map = byId(layers);
  const peek = opts.sources ?? peekLayerCanvas;
  const peekMask = opts.masks ?? peekMaskCanvas;
  // Known-blank is a fact about the editor's registry, so it is only trusted
  // when the pixels come from the registry too.
  const blank = opts.sources ? () => false : isLayerBlank;

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
  const ops: DrawOp[] = [];
  for (const layer of ordered) {
    if (opts.skipId === layer.id) continue;
    if (!effectiveVisible(layer, map)) continue;
    // A fully transparent canvas draws nothing under every blend mode we offer
    // (all of them leave the backdrop alone where the source alpha is 0).
    if (layer.kind === "raster" && blank(layer.id)) continue;

    const alpha = effectiveOpacity(layer, map);
    if (alpha <= 0) continue;

    const prepared = prepareLayer(layer, peek, peekMask);
    if (!prepared) continue;

    const m = layerMatrix(layer);
    const op = blendOp(layer.blendMode);
    const key = `${layer.id}|${prepared.sig}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}|${alpha}|${op}`;
    ops.push({ layer, prepared, alpha, op, key });
  }
  return ops;
}

function drawOp(ctx: CanvasRenderingContext2D, { layer, prepared, alpha, op }: DrawOp): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
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

function fillBackground(ctx: CanvasRenderingContext2D, background: string | undefined, w: number, h: number) {
  if (background && background !== "#00000000") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
}

export function composite(
  layers: Layer[],
  width: number,
  height: number,
  opts: CompositeOptions = {},
): HTMLCanvasElement {
  const out = createCanvas(width, height);
  const ctx = ctx2d(out);
  fillBackground(ctx, opts.background, width, height);
  for (const op of drawOps(layers, opts)) drawOp(ctx, op);
  return out;
}

// ── Stack compositor (the on-screen view) ─────────────────────────────────────
//
// The prepared cache makes each layer cheap, but a composite still blits every
// layer, and in a document built by pressing "New raster layer" every layer is
// DOCUMENT-SIZED. Forty of them is forty full-document blits per brush dab or
// per pointermove of a drag — measured at ~80ms a frame, with all the time in
// `drawImage`.
//
// But a gesture only ever changes one layer: the one being painted or dragged.
// So, the way image editors have always done it, the stack is split around that
// focus layer:
//
//     [ below — cached ]   [ focus — drawn live ]   [ above — cached ]
//
// and a frame is three blits however tall the stack is. Each cached half is
// keyed by the draw keys of the layers in it, so it is rebuilt only when one of
// THOSE layers changes (or the focus moves to another layer, which is a click,
// not a frame).
//
// Correctness of the split:
//   • below is a prefix of the exact draw sequence `composite` runs, background
//     included, so it is not an approximation of anything;
//   • above can be pre-flattened into its own transparent canvas only when every
//     layer in it is plain source-over, because "over" is associative and every
//     blend mode is not. With any blended layer above the focus, the above layers
//     are drawn one by one onto the result instead — still correct, just not
//     sped up.
//
// Export keeps calling `composite` directly, so what is saved never depends on
// this cache. The Navigator's minimap shares the view's instance (see
// `renderView`): it used to run a full uncached composite 220ms after every
// change — forty document-sized blits, a visible hitch just after a stroke ends.

interface Cached { key: string; canvas: HTMLCanvasElement }

export class StackCompositor {
  private below: Cached | null = null;
  private above: Cached | null = null;
  private out: HTMLCanvasElement | null = null;
  /** The draw keys `out` currently shows. */
  private frameKey = "";
  /** The flattened document. The returned canvas is reused by the next call —
   *  draw it (or copy it) before compositing again. */
  render(
    layers: Layer[], width: number, height: number,
    opts: CompositeOptions & { focusId?: string | null } = {},
  ): HTMLCanvasElement {
    const ops = drawOps(layers, opts);
    let f = opts.focusId ? ops.findIndex((o) => o.layer.id === opts.focusId) : -1;
    if (f < 0) f = ops.length; // no focus: the whole stack is "below"

    const size = `${width}x${height}`;
    const belowOps = ops.slice(0, f);
    const belowKey = `${size}|${opts.background ?? ""}|` + belowOps.map((o) => o.key).join(";");
    if (!this.below || this.below.key !== belowKey) {
      const c = this.below?.canvas.width === width && this.below.canvas.height === height
        ? this.below.canvas : createCanvas(width, height);
      const ctx = ctx2d(c);
      ctx.clearRect(0, 0, width, height);
      fillBackground(ctx, opts.background, width, height);
      for (const op of belowOps) drawOp(ctx, op);
      this.below = { key: belowKey, canvas: c };
    }
    if (f >= ops.length) return this.below.canvas;

    const aboveOps = ops.slice(f + 1);
    const flattenAbove = aboveOps.length > 1 && aboveOps.every((o) => o.op === "source-over");
    if (flattenAbove) {
      const aboveKey = `${size}|` + aboveOps.map((o) => o.key).join(";");
      if (!this.above || this.above.key !== aboveKey) {
        const c = this.above?.canvas.width === width && this.above.canvas.height === height
          ? this.above.canvas : createCanvas(width, height);
        const ctx = ctx2d(c);
        ctx.clearRect(0, 0, width, height);
        for (const op of aboveOps) drawOp(ctx, op);
        this.above = { key: aboveKey, canvas: c };
      }
    }

    const focus = ops[f];
    // Everything the frame is built from. When none of it changed (the Navigator
    // asking for the frame the canvas just drew, a redraw for an overlay), the
    // last frame is still exact — hand it back rather than re-assemble it.
    const frameKey = `${belowKey}#${focus.key}#${aboveOps.map((o) => o.key).join(";")}`;
    if (this.out && this.frameKey === frameKey) return this.out;

    // Why the whole frame is re-assembled, not just the rectangle the focus
    // layer moved through: measured, Skia rasterises a transformed layer
    // slightly differently depending on where it sits against the canvas
    // edges, so ANY cropped or clipped repaint (both were tried) comes out up
    // to ~20/255 off a full redraw — a visible seam. e2e/stack-compositor.spec
    // is the test that caught it.
    if (!this.out || this.out.width !== width || this.out.height !== height) {
      this.out = createCanvas(width, height);
    }
    const ctx = ctx2d(this.out);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.below.canvas, 0, 0);
    drawOp(ctx, focus);
    if (flattenAbove) ctx.drawImage(this.above!.canvas, 0, 0);
    else for (const op of aboveOps) drawOp(ctx, op);
    this.frameKey = frameKey;
    return this.out;
  }
}

let view: StackCompositor | null = null;

/**
 * The flattened document as the editor shows it, through ONE shared
 * StackCompositor — the canvas and the Navigator ask for the same stack, so the
 * second of them is three blits, not a recomposite. The returned canvas is
 * reused by the next call: draw it before calling again.
 */
export function renderView(
  layers: Layer[], width: number, height: number,
  opts: CompositeOptions & { focusId?: string | null } = {},
): HTMLCanvasElement {
  view ??= new StackCompositor();
  return view.render(layers, width, height, opts);
}
