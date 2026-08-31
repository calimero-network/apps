import { describe, it, expect } from "vitest";
import { handlePoints, hitHandle, scaleSigns, ROT_KNOB_OFFSET } from "./gizmo";
import { makeLayer } from "../test/factories";

const square = () => makeLayer({ x: 0, y: 0, width: 100, height: 100 });

describe("handlePoints", () => {
  it("puts the corners on the layer's box", () => {
    const p = handlePoints(square());
    expect(p.tl).toEqual({ x: 0, y: 0 });
    expect(p.tr).toEqual({ x: 100, y: 0 });
    expect(p.br).toEqual({ x: 100, y: 100 });
    expect(p.bl).toEqual({ x: 0, y: 100 });
  });

  it("puts the shear grips at the edge midpoints", () => {
    const p = handlePoints(square());
    expect(p.top).toEqual({ x: 50, y: 0 });
    expect(p.bottom).toEqual({ x: 50, y: 100 });
    expect(p.left).toEqual({ x: 0, y: 50 });
    expect(p.right).toEqual({ x: 100, y: 50 });
  });

  it("stands the rotation knob off the top edge", () => {
    const p = handlePoints(square());
    expect(p.rot).toEqual({ x: 50, y: -ROT_KNOB_OFFSET });
  });

  it("keeps the knob outside the shape when the layer is upside down", () => {
    // Rotated 180°, the "top" edge is at the BOTTOM of the screen, so the knob has
    // to point down — a fixed −28px offset would bury it in the artwork.
    const p = handlePoints(makeLayer({ x: 0, y: 0, width: 100, height: 100, rotation: 180 }));
    expect(p.rot.y).toBeCloseTo(100 + ROT_KNOB_OFFSET, 6);
    expect(p.rot.x).toBeCloseTo(50, 6);
  });

  it("follows a rotation", () => {
    const p = handlePoints(makeLayer({ x: 0, y: 0, width: 100, height: 100, rotation: 90 }));
    expect(p.tl.x).toBeCloseTo(100, 6);
    expect(p.tl.y).toBeCloseTo(0, 6);
    expect(p.rot.x).toBeCloseTo(100 + ROT_KNOB_OFFSET, 6);
  });

  it("follows a warp", () => {
    const p = handlePoints(makeLayer({
      x: 0, y: 0, width: 100, height: 100,
      warp: '{"tl":[10,5],"tr":[0,0],"br":[0,0],"bl":[0,0]}',
    }));
    expect(p.tl).toEqual({ x: 10, y: 5 });
    expect(p.top).toEqual({ x: 55, y: 2.5 });
  });

  it("follows a mirror and a scale", () => {
    const p = handlePoints(makeLayer({
      x: 0, y: 0, width: 100, height: 50, flipH: true, scaleX: 200,
    }));
    expect(p.tl.x).toBeCloseTo(200, 6); // mirrored: local (0,0) lands on the right
    expect(p.tr.x).toBeCloseTo(0, 6);
  });
});

describe("hitHandle", () => {
  it("finds each corner, edge grip and the knob", () => {
    const l = square();
    expect(hitHandle(l, 0, 0, 1)).toBe("tl");
    expect(hitHandle(l, 100, 0, 1)).toBe("tr");
    expect(hitHandle(l, 100, 100, 1)).toBe("br");
    expect(hitHandle(l, 0, 100, 1)).toBe("bl");
    expect(hitHandle(l, 50, 0, 1)).toBe("skew-top");
    expect(hitHandle(l, 50, 100, 1)).toBe("skew-bottom");
    expect(hitHandle(l, 0, 50, 1)).toBe("skew-left");
    expect(hitHandle(l, 100, 50, 1)).toBe("skew-right");
    expect(hitHandle(l, 50, -ROT_KNOB_OFFSET, 1)).toBe("rot");
  });

  it("answers null well away from any handle", () => {
    expect(hitHandle(square(), 50, 50, 1)).toBeNull();
    expect(hitHandle(square(), 500, 500, 1)).toBeNull();
  });

  it("prefers a corner over the edge grip beside it", () => {
    // A tiny layer puts a corner and an edge midpoint within one tolerance of each
    // other; the corner must win, because scaling is the more common intent.
    const tiny = makeLayer({ x: 0, y: 0, width: 12, height: 12 });
    expect(hitHandle(tiny, 0, 0, 1)).toBe("tl");
  });

  it("shrinks its grab radius as you zoom in", () => {
    const l = square();
    // 8 doc-px away: inside the 10px tolerance at zoom 1, outside it at zoom 4
    expect(hitHandle(l, 8, 0, 1)).toBe("tl");
    expect(hitHandle(l, 8, 0, 4)).toBeNull();
  });

  it("survives a zoom of zero rather than dividing by it", () => {
    expect(() => hitHandle(square(), 0, 0, 0)).not.toThrow();
  });

  it("offers only the corner pins in warp mode", () => {
    const l = square();
    expect(hitHandle(l, 0, 0, 1, true)).toBe("warp-tl");
    expect(hitHandle(l, 100, 0, 1, true)).toBe("warp-tr");
    expect(hitHandle(l, 100, 100, 1, true)).toBe("warp-br");
    expect(hitHandle(l, 0, 100, 1, true)).toBe("warp-bl");
    // edges and the rotation knob are inert while warping
    expect(hitHandle(l, 50, 0, 1, true)).toBeNull();
    expect(hitHandle(l, 50, -ROT_KNOB_OFFSET, 1, true)).toBeNull();
  });

  it("hit-tests a rotated layer in its rotated position", () => {
    const l = makeLayer({ x: 0, y: 0, width: 100, height: 100, rotation: 90 });
    expect(hitHandle(l, 100, 0, 1)).toBe("tl"); // the top-left corner swung right
    expect(hitHandle(l, 0, 0, 1)).toBe("bl");
  });
});

describe("scaleSigns", () => {
  it("grows towards the cursor for every corner", () => {
    expect(scaleSigns("br")).toEqual({ x: 1, y: 1 });
    expect(scaleSigns("tr")).toEqual({ x: 1, y: -1 });
    expect(scaleSigns("bl")).toEqual({ x: -1, y: 1 });
    expect(scaleSigns("tl")).toEqual({ x: -1, y: -1 });
  });
});
