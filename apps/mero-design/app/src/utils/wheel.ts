// ── What a wheel event means on a canvas ─────────────────────────────────────
//
// Figma's split, and the one every trackpad user already has in their hands:
// two fingers pan, pinch zooms, ⌘/Ctrl + wheel zooms.
//
// The canvas used to zoom on EVERY wheel event, off `deltaY` alone, at
// `0.999 ** deltaY`. Two consequences, both reported:
//
//   * a two-finger swipe left/right is almost pure `deltaX`, so it crawled,
//     while the same gesture up/down flew. The axes were never meant to do the
//     same job — one of them is a pan.
//   * pinch arrives as a wheel event with `ctrlKey` set and a SMALL `deltaY` —
//     single digits, against ~100 for one mouse notch. At `0.999 ** deltaY`
//     that is about 1% per event. The curve was tuned for a mouse, and a
//     trackpad was being asked to drive it.
//
// Pulled out of the canvas because it is the part with the arithmetic in it,
// and a decision this fiddly should be readable without a Fabric canvas
// attached to it.

/** Per-unit-delta zoom rate for a pinch, whose deltas are small. */
export const PINCH_RATE = 0.01;
/** Per-unit-delta zoom rate for ⌘/Ctrl + wheel, whose deltas are ~100x larger. */
export const WHEEL_ZOOM_RATE = 0.0025;
/** A flung trackpad can emit one enormous delta; cap the per-event jump. */
export const MAX_DELTA = 120;

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0 = pixels, 1 = lines, 2 = pages. */
  deltaMode: number;
  /**
   * The pinch signal on every browser — synthesised by the OS, with no real
   * Ctrl key held. A literal Ctrl+wheel is indistinguishable, which is fine:
   * both mean zoom.
   */
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type WheelAction =
  /** Multiply the current zoom by this. Multiplicative, so a step feels the
   *  same at 5% as at 400%. */
  | { kind: "zoom"; factor: number }
  /** Move the viewport by this many screen pixels. */
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "none" };

/**
 * Wheel deltas are only in pixels when `deltaMode` says so. Firefox reports
 * lines, and a page-mode delta of 1 means a whole viewport — read raw, the same
 * gesture is ~16x or ~100x stronger there.
 */
export function toPixels(
  value: number,
  mode: number,
  pageSize: number,
): number {
  if (mode === 1) return value * 16;
  if (mode === 2) return value * pageSize;
  return value;
}

/** Viewport size, needed only to read a page-mode delta. */
export interface Viewport {
  width: number;
  height: number;
}

export function wheelAction(e: WheelLike, viewport: Viewport): WheelAction {
  const dx = toPixels(e.deltaX, e.deltaMode, viewport.width);
  const dy = toPixels(e.deltaY, e.deltaMode, viewport.height);

  if (e.ctrlKey || e.metaKey) {
    // ctrlKey wins when both are set: it is the pinch, and a pinch is what the
    // hand is doing regardless of what the other hand is holding.
    const rate = e.ctrlKey ? PINCH_RATE : WHEEL_ZOOM_RATE;
    const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, dy));
    if (delta === 0) return { kind: "none" };
    // Negative delta is "away from the user", which zooms IN.
    return { kind: "zoom", factor: Math.exp(-delta * rate) };
  }

  // Shift swaps the axis, for a mouse with only one wheel. Ignored when the
  // device already reported a horizontal delta — a trackpad does not need it,
  // and honouring both would cancel the gesture out.
  const [panX, panY] = e.shiftKey && dx === 0 ? [dy, 0] : [dx, dy];
  if (panX === 0 && panY === 0) return { kind: "none" };
  // The content moves opposite to the scroll: scrolling down reveals what is
  // below, which slides the scene up.
  return { kind: "pan", dx: -panX, dy: -panY };
}
