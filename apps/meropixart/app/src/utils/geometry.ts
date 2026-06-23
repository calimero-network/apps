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

/** A Path2D describing the selection in document space (for overlay/marching ants). */
export function selectionPathDoc(sel: Selection): Path2D {
  const p = new Path2D();
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
export function selectionPathLocal(sel: Selection, layer: Layer): Path2D {
  const p = new Path2D();
  const map = (x: number, y: number) => docToLayerLocal(layer, x, y);
  if (sel.kind === "rect") {
    const a = map(sel.x, sel.y);
    const b = map(sel.x + sel.w, sel.y);
    const c = map(sel.x + sel.w, sel.y + sel.h);
    const d = map(sel.x, sel.y + sel.h);
    p.moveTo(a.x, a.y);
    p.lineTo(b.x, b.y);
    p.lineTo(c.x, c.y);
    p.lineTo(d.x, d.y);
    p.closePath();
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

/** Normalise a drag (start→current) into a positive-extent rect. */
export function normRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}
