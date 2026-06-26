// ── Per-layer pixel registry ──────────────────────────────────────────────
//
// Layer pixels live in off-DOM canvases, NOT in React/zustand state (they're
// large and mutated imperatively by paint tools). The compositor and tools read
// from here; the store holds only layer *metadata*. Keyed by layer id.

import { createCanvas, ctx2d } from "../utils/raster";

const canvases = new Map<string, HTMLCanvasElement>();

/** Get (or lazily create a blank) source canvas for a layer at the given size. */
export function getLayerCanvas(id: string, width: number, height: number): HTMLCanvasElement {
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

export function peekLayerCanvas(id: string): HTMLCanvasElement | undefined {
  return canvases.get(id);
}

export function setLayerCanvas(id: string, canvas: HTMLCanvasElement): void {
  canvases.set(id, canvas);
}

export function dropLayerCanvas(id: string): void {
  canvases.delete(id);
}

export function snapshotLayerCanvas(id: string): string | null {
  const c = canvases.get(id);
  return c ? c.toDataURL("image/png") : null;
}

// ── Mask registry (grayscale canvases) ──────────────────────────────────────

const masks = new Map<string, HTMLCanvasElement>();

export function getMaskCanvas(id: string, width: number, height: number): HTMLCanvasElement {
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
  masks.set(id, canvas);
}

export function dropMaskCanvas(id: string): void {
  masks.delete(id);
}

/** Wipe every layer + mask canvas — call when switching projects so one
 *  document's pixels never leak into another. */
export function clearAllCanvases(): void {
  canvases.clear();
  masks.clear();
}
