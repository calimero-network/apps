// ── Transform gizmo geometry ──────────────────────────────────────────────────
//
// Where the handles are, and which one a click grabbed. Kept out of CanvasStage
// because it is pure arithmetic that deserves its own tests — a handle that is
// drawn in one place and hit-tested in another is the classic way a transform
// gizmo goes subtly wrong.
//
// Everything is in DOCUMENT space and read straight off the layer's own transform
// (see ./transform), so the box sits exactly on the pixels: rotated, sheared,
// mirrored, warped, or all four at once.

import type { Layer } from "../types";
import { centerOf, cornersOf } from "./transform";

export interface Point { x: number; y: number; }

export interface HandlePoints {
  /** corners, clockwise from the top-left, warp included */
  tl: Point; tr: Point; br: Point; bl: Point;
  /** edge midpoints — the shear grips */
  top: Point; bottom: Point; left: Point; right: Point;
  /** the rotation knob, standing off the top edge along its outward normal */
  rot: Point;
  /** the layer's centre of rotation */
  cx: number; cy: number;
}

/** How far the rotation knob stands off the top edge, in document units. */
export const ROT_KNOB_OFFSET = 28;

/** Grab radius for a handle, in document units at the given zoom. */
export const HANDLE_TOLERANCE = 10;

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function handlePoints(layer: Layer): HandlePoints {
  const [tl, tr, br, bl] = cornersOf(layer);
  const top = mid(tl, tr);
  const bottom = mid(bl, br);
  const left = mid(tl, bl);
  const right = mid(tr, br);
  const { cx, cy } = centerOf(layer);
  // Outward normal of the top edge, so the knob leans away from the shape even
  // when the layer is rotated past 90° — a knob that dives INTO the artwork is
  // both ugly and unclickable.
  const nx = top.x - cx;
  const ny = top.y - cy;
  const len = Math.hypot(nx, ny) || 1;
  const rot = { x: top.x + (nx / len) * ROT_KNOB_OFFSET, y: top.y + (ny / len) * ROT_KNOB_OFFSET };
  return { tl, tr, br, bl, top, bottom, left, right, rot, cx, cy };
}

/** Handle names the gizmo can return. */
export type HandleName =
  | "rot" | "tl" | "tr" | "br" | "bl"
  | "skew-top" | "skew-bottom" | "skew-left" | "skew-right"
  | "warp-tl" | "warp-tr" | "warp-br" | "warp-bl";

/**
 * Which handle (if any) is under a document-space point.
 *
 * Corners win over edges, and in warp mode ONLY the corners are live: the corner
 * pins and the scale handles occupy the same spots, so the mode decides what a
 * grab means rather than a modifier key you have to remember.
 */
export function hitHandle(
  layer: Layer, x: number, y: number, zoom: number, warpMode = false,
): HandleName | null {
  const p = handlePoints(layer);
  const tol = HANDLE_TOLERANCE / Math.max(0.01, zoom);
  const near = (q: Point) => Math.hypot(x - q.x, y - q.y) < tol;
  if (warpMode) {
    if (near(p.tl)) return "warp-tl";
    if (near(p.tr)) return "warp-tr";
    if (near(p.br)) return "warp-br";
    if (near(p.bl)) return "warp-bl";
    return null;
  }
  if (near(p.rot)) return "rot";
  if (near(p.br)) return "br";
  if (near(p.tr)) return "tr";
  if (near(p.bl)) return "bl";
  if (near(p.tl)) return "tl";
  if (near(p.top)) return "skew-top";
  if (near(p.bottom)) return "skew-bottom";
  if (near(p.left)) return "skew-left";
  if (near(p.right)) return "skew-right";
  return null;
}

/** The sign a corner handle applies to a drag: which way it grows the layer. */
export function scaleSigns(handle: HandleName): { x: number; y: number } {
  return {
    x: handle === "tl" || handle === "bl" ? -1 : 1,
    y: handle === "tl" || handle === "tr" ? -1 : 1,
  };
}
