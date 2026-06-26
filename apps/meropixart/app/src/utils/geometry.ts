// ── Geometry helpers ──────────────────────────────────────────────────────────
//
// Conversions between document space and a layer's local pixel space (honouring
// the layer's position, scale and rotation), plus Path2D builders for the active
// pixel selection used to constrain painting/fill/shape/gradient operations.

import type { Layer, Selection } from "../types";

/** Map a document-space point into a layer's local (unscaled, unrotated) pixels. */
export function docToLayerLocal(layer: Layer, dx: number, dy: number): { x: number; y: number } {
  const sx = (layer.scaleX || 100) / 100;
  const sy = (layer.scaleY || 100) / 100;
  const cx = layer.x + (layer.width * sx) / 2;
  const cy = layer.y + (layer.height * sy) / 2;
  const x = dx - cx;
  const y = dy - cy;
  const r = (-layer.rotation * Math.PI) / 180;
  const rx = x * Math.cos(r) - y * Math.sin(r);
  const ry = x * Math.sin(r) + y * Math.cos(r);
  return { x: rx / sx + layer.width / 2, y: ry / sy + layer.height / 2 };
}

/** Document bounds used to build the outer ring of an inverted selection. */
export interface DocBounds { width: number; height: number; }

/** A Path2D describing the selection in document space (for overlay/marching ants).
 *  When `sel.inverted` and `bounds` are given, the doc rectangle is prepended so
 *  an even-odd fill/clip yields everything OUTSIDE the shape. */
export function selectionPathDoc(sel: Selection, bounds?: DocBounds): Path2D {
  const p = new Path2D();
  if (sel.inverted && bounds) p.rect(0, 0, bounds.width, bounds.height);
  if (sel.kind === "rect") {
    p.rect(sel.x, sel.y, sel.w, sel.h);
  } else {
    const pts = sel.points;
    if (pts.length >= 2) {
      p.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
      p.closePath();
    }
  }
  return p;
}

/** A Path2D describing the selection transformed into a layer's local pixel space. */
export function selectionPathLocal(sel: Selection, layer: Layer, bounds?: DocBounds): Path2D {
  const p = new Path2D();
  const map = (x: number, y: number) => docToLayerLocal(layer, x, y);
  const ring = (corners: Array<[number, number]>) => {
    const first = map(corners[0][0], corners[0][1]);
    p.moveTo(first.x, first.y);
    for (let i = 1; i < corners.length; i++) {
      const q = map(corners[i][0], corners[i][1]);
      p.lineTo(q.x, q.y);
    }
    p.closePath();
  };
  if (sel.inverted && bounds) {
    ring([[0, 0], [bounds.width, 0], [bounds.width, bounds.height], [0, bounds.height]]);
  }
  if (sel.kind === "rect") {
    ring([[sel.x, sel.y], [sel.x + sel.w, sel.y], [sel.x + sel.w, sel.y + sel.h], [sel.x, sel.y + sel.h]]);
  } else {
    const pts = sel.points;
    if (pts.length >= 2) {
      const first = map(pts[0], pts[1]);
      p.moveTo(first.x, first.y);
      for (let i = 2; i < pts.length; i += 2) {
        const q = map(pts[i], pts[i + 1]);
        p.lineTo(q.x, q.y);
      }
      p.closePath();
    }
  }
  return p;
}

/** Selection ops for the Select menu (Inverse / Expand / Contract). */
export function invertSelection(sel: Selection): Selection {
  return { ...sel, inverted: !sel.inverted };
}

/** Grow (delta>0) or shrink (delta<0) a selection by `delta` doc px. Rect grows
 *  precisely; polygons are scaled about their centroid as an approximation. */
export function resizeSelection(sel: Selection, delta: number, bounds: DocBounds): Selection {
  if (sel.kind === "rect") {
    const x = sel.x - delta;
    const y = sel.y - delta;
    const w = sel.w + delta * 2;
    const h = sel.h + delta * 2;
    if (w < 1 || h < 1) return sel;
    return {
      ...sel,
      x: Math.max(0, x), y: Math.max(0, y),
      w: Math.min(bounds.width, w), h: Math.min(bounds.height, h),
    };
  }
  const pts = sel.points;
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
  const n = pts.length / 2;
  cx /= n; cy /= n;
  // average radius → scale factor that moves the boundary out/in by ~delta
  let r = 0;
  for (let i = 0; i < pts.length; i += 2) r += Math.hypot(pts[i] - cx, pts[i + 1] - cy);
  r /= n;
  const k = r > 0 ? (r + delta) / r : 1;
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    out.push(cx + (pts[i] - cx) * k, cy + (pts[i + 1] - cy) * k);
  }
  return { ...sel, points: out };
}

/** Normalise a drag (start→current) into a positive-extent rect. */
export function normRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}
