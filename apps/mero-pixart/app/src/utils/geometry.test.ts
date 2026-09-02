import { describe, it, expect } from "vitest";
import {
  docToLayerLocal, invertSelection, normRect, resizeSelection,
  selectionPathDoc, selectionPathLocal,
} from "./geometry";
import { makeLayer } from "../test/factories";
import { StubPath2D } from "../test/canvasStub";
import type { Selection } from "../types";

/** The ops a Path2D recorded, so a "clip to the selection" can be asserted on. */
function ops(path: Path2D) {
  return (path as unknown as StubPath2D).ops;
}

const rect: Selection = { kind: "rect", x: 10, y: 20, w: 30, h: 40 };
const poly: Selection = { kind: "poly", points: [0, 0, 10, 0, 10, 10] };

describe("normRect", () => {
  it("normalises a drag in any direction to positive extents", () => {
    expect(normRect(10, 10, 40, 30)).toEqual({ x: 10, y: 10, w: 30, h: 20 });
    expect(normRect(40, 30, 10, 10)).toEqual({ x: 10, y: 10, w: 30, h: 20 });
  });

  it("gives a zero-size rect for a click without a drag", () => {
    expect(normRect(5, 5, 5, 5)).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

describe("docToLayerLocal", () => {
  it("is the identity for an untransformed layer at the origin", () => {
    const l = makeLayer({ x: 0, y: 0, width: 100, height: 100 });
    expect(docToLayerLocal(l, 25, 75)).toEqual({ x: 25, y: 75 });
  });

  it("honours shear, which the old position-only maths could not", () => {
    const l = makeLayer({ x: 0, y: 0, width: 100, height: 100, skewX: 45 });
    // The top-left corner sits at doc (−50, 0) once sheared, so that doc point
    // must map back to local (0,0) — a brush stroke lands under the cursor.
    const p = docToLayerLocal(l, -50, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe("selectionPathDoc", () => {
  it("describes a rect selection in document space", () => {
    expect(ops(selectionPathDoc(rect))).toEqual([{ op: "rect", args: [10, 20, 30, 40] }]);
  });

  it("walks a polygon and closes it", () => {
    const recorded = ops(selectionPathDoc(poly));
    expect(recorded.map((o) => o.op)).toEqual(["moveTo", "lineTo", "lineTo", "closePath"]);
    expect(recorded[0].args).toEqual([0, 0]);
  });

  it("prepends the document rectangle for an inverted selection", () => {
    const recorded = ops(selectionPathDoc({ ...rect, inverted: true }, { width: 200, height: 100 }));
    // even-odd against the outer ring is what makes "everything outside" work
    expect(recorded[0]).toEqual({ op: "rect", args: [0, 0, 200, 100] });
    expect(recorded[1]).toEqual({ op: "rect", args: [10, 20, 30, 40] });
  });

  it("ignores the inversion when no document bounds are supplied", () => {
    expect(ops(selectionPathDoc({ ...rect, inverted: true }))).toHaveLength(1);
  });

  it("emits an empty path for a degenerate polygon", () => {
    expect(ops(selectionPathDoc({ kind: "poly", points: [] }))).toEqual([]);
  });
});

describe("selectionPathLocal", () => {
  it("maps the selection's corners through the layer's transform", () => {
    const l = makeLayer({ x: 10, y: 20, width: 100, height: 100 });
    const recorded = ops(selectionPathLocal(rect, l));
    // A layer offset by (10,20) shifts the selection back by the same amount.
    expect(recorded[0]).toEqual({ op: "moveTo", args: [0, 0] });
    expect(recorded[recorded.length - 1]).toEqual({ op: "closePath", args: [] });
  });

  it("becomes four line segments, not a rect, because it may be rotated", () => {
    const l = makeLayer({ rotation: 30 });
    const recorded = ops(selectionPathLocal(rect, l));
    expect(recorded.map((o) => o.op)).toEqual(["moveTo", "lineTo", "lineTo", "lineTo", "closePath"]);
  });

  it("adds the document ring for an inverted selection", () => {
    const l = makeLayer();
    const recorded = ops(selectionPathLocal({ ...rect, inverted: true }, l, { width: 50, height: 50 }));
    // outer ring (4 points) then the shape (4 points), each closed
    expect(recorded.filter((o) => o.op === "closePath")).toHaveLength(2);
  });
});

describe("invertSelection", () => {
  it("toggles the flag both ways and keeps the shape", () => {
    const once = invertSelection(rect);
    expect(once.inverted).toBe(true);
    expect(invertSelection(once).inverted).toBe(false);
    expect(once.kind).toBe("rect");
  });
});

describe("resizeSelection", () => {
  const bounds = { width: 200, height: 200 };

  it("grows a rect on all four sides", () => {
    expect(resizeSelection(rect, 5, bounds)).toMatchObject({ x: 5, y: 15, w: 40, h: 50 });
  });

  it("shrinks a rect", () => {
    expect(resizeSelection(rect, -5, bounds)).toMatchObject({ x: 15, y: 25, w: 20, h: 30 });
  });

  it("clamps to the document rather than going negative", () => {
    const grown = resizeSelection(rect, 100, bounds) as Extract<Selection, { kind: "rect" }>;
    expect(grown.x).toBe(0);
    expect(grown.y).toBe(0);
    expect(grown.w).toBeLessThanOrEqual(bounds.width);
  });

  it("refuses a contraction that would collapse the selection", () => {
    expect(resizeSelection(rect, -20, bounds)).toBe(rect);
  });

  it("scales a polygon about its centroid", () => {
    const grown = resizeSelection(poly, 5, bounds) as Extract<Selection, { kind: "poly" }>;
    expect(grown.points).toHaveLength(poly.kind === "poly" ? poly.points.length : 0);
    // every point moves outward, so the bounding box gets bigger
    const spanBefore = Math.max(...(poly.kind === "poly" ? poly.points : [])) ;
    const spanAfter = Math.max(...grown.points);
    expect(spanAfter).toBeGreaterThan(spanBefore);
  });
});
