// ── Per-layer pixel registry ──────────────────────────────────────────────
//
// Layer pixels live in off-DOM canvases, NOT in React/zustand state (they're
// large and mutated imperatively by paint tools). The compositor and tools read
// from here; the store holds only layer *metadata*. Keyed by layer id.

import { createCanvas, ctx2d } from "../utils/raster";

const canvases = new Map<string, HTMLCanvasElement>();

// ── Pixel versions ──────────────────────────────────────────────────────────
//
// The compositor caches expensive per-layer work (a blur filter pass, a mask
// conversion, a warp mesh) and needs to know when a layer's pixels changed. It
// cannot watch the canvas: tools mutate it through a 2D context, invisibly.
//
// The rule that makes this safe rests on the split already in this module:
//
//   getLayerCanvas / getMaskCanvas  →  "I am about to draw on this"  → bump
//   peekLayerCanvas / peekMaskCanvas →  "I am only reading it"       → no bump
//
// Every mutation path obtains its context from a `get*` (a brush dab calls it
// per dab), so no change can slip past. A `get*` that turns out to be read-only
// merely re-does the cached work once — over-invalidating is cheap, missing an
// invalidation would paint stale pixels.

const pixelVersions = new Map<string, number>();
const maskVersions = new Map<string, number>();

function bump(map: Map<string, number>, id: string): void {
  map.set(id, (map.get(id) ?? 0) + 1);
}

/** Monotonic counter for a layer's source pixels. */
export function layerPixelVersion(id: string): number {
  return pixelVersions.get(id) ?? 0;
}

/** Monotonic counter for a layer's mask pixels. */
export function maskPixelVersion(id: string): number {
  return maskVersions.get(id) ?? 0;
}

/** Get (or lazily create a blank) source canvas for a layer at the given size. */
export function getLayerCanvas(id: string, width: number, height: number): HTMLCanvasElement {
  bump(pixelVersions, id); // write intent — see "Pixel versions" above
  let c = canvases.get(id);
  if (!c) {
    c = createCanvas(width, height);
    canvases.set(id, c);
  } else if (c.width !== Math.max(1, Math.round(width)) || c.height !== Math.max(1, Math.round(height))) {
    // Resize while preserving existing pixels (top-left anchored).
    const next = createCanvas(width, height);
    ctx2d(next).drawImage(c, 0, 0);
    canvases.set(id, next);
    c = next;
  }
  return c;
}

// ── Known-blank layers ──────────────────────────────────────────────────────
//
// "New raster layer" allocates a document-sized, fully transparent canvas. Forty
// of those cost the compositor forty full-document blits that draw nothing. So a
// caller that KNOWS it just made a blank canvas says so, and the flag is pinned
// to the pixel version at that moment: the first `get*` (every write path goes
// through one — see "Pixel versions") bumps the version and the flag is gone.
// Nothing ever has to remember to clear it.

const blankAt = new Map<string, number>();

/** Record that a layer's canvas is, right now, fully transparent. */
export function markLayerBlank(id: string): void {
  blankAt.set(id, layerPixelVersion(id));
}

/** True only while no write intent has touched the canvas since {@link markLayerBlank}. */
export function isLayerBlank(id: string): boolean {
  const at = blankAt.get(id);
  return at !== undefined && at === layerPixelVersion(id);
}

export function peekLayerCanvas(id: string): HTMLCanvasElement | undefined {
  return canvases.get(id);
}

export function setLayerCanvas(id: string, canvas: HTMLCanvasElement): void {
  bump(pixelVersions, id);
  canvases.set(id, canvas);
}

export function dropLayerCanvas(id: string): void {
  bump(pixelVersions, id);
  canvases.delete(id);
}

export function snapshotLayerCanvas(id: string): string | null {
  const c = canvases.get(id);
  return c ? c.toDataURL("image/png") : null;
}

// ── Mask registry (grayscale canvases) ──────────────────────────────────────

const masks = new Map<string, HTMLCanvasElement>();

export function getMaskCanvas(id: string, width: number, height: number): HTMLCanvasElement {
  bump(maskVersions, id); // write intent
  let c = masks.get(id);
  if (!c) {
    c = createCanvas(width, height);
    const ctx = ctx2d(c);
    ctx.fillStyle = "#ffffff"; // white = fully revealed
    ctx.fillRect(0, 0, c.width, c.height);
    masks.set(id, c);
  }
  return c;
}

export function peekMaskCanvas(id: string): HTMLCanvasElement | undefined {
  return masks.get(id);
}

export function setMaskCanvas(id: string, canvas: HTMLCanvasElement): void {
  bump(maskVersions, id);
  masks.set(id, canvas);
}

export function dropMaskCanvas(id: string): void {
  bump(maskVersions, id);
  masks.delete(id);
}

/** Wipe every layer + mask canvas — call when switching projects so one
 *  document's pixels never leak into another. */
export function clearAllCanvases(): void {
  canvases.clear();
  masks.clear();
  // Versions deliberately keep counting: a new document may reuse an id (the
  // showcase loader uses deterministic ones in tests), and a reset counter could
  // collide with a cached signature from the document just closed.
  for (const id of [...pixelVersions.keys()]) bump(pixelVersions, id);
  for (const id of [...maskVersions.keys()]) bump(maskVersions, id);
}
