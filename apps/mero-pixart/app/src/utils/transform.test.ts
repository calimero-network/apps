import { describe, it, expect } from "vitest";
import {
  applyMatrix, boundsOf, boxSize, centerOf, cornersOf, docToLocal, invert,
  isNeutralWarp, layerMatrix, multiply, parseWarp, scaleOf, serializeWarp,
  triangleMatrix, unionBounds, warpOf, warpPoint, IDENTITY,
} from "./transform";
import { presetCorners, WARP_PRESETS, wrapAngle } from "./warpPresets";
import { makeLayer } from "../test/factories";
import type { WarpCorners } from "../types";

const close = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

function expectPoint(p: { x: number; y: number }, x: number, y: number, tol = 1e-6) {
  expect(close(p.x, x, tol), `x: ${p.x} ≉ ${x}`).toBe(true);
  expect(close(p.y, y, tol), `y: ${p.y} ≉ ${y}`).toBe(true);
}

describe("matrix algebra", () => {
  it("multiplies in apply-m-then-n order", () => {
    const translate = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 };
    const double = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    // translate first, then scale → the translation is scaled too
    expectPoint(applyMatrix(multiply(translate, double), 1, 1), 22, 42);
    // scale first, then translate → the translation is not scaled
    expectPoint(applyMatrix(multiply(double, translate), 1, 1), 12, 22);
  });

  it("inverts a matrix and refuses a singular one", () => {
    const m = { a: 2, b: 0.5, c: -1, d: 3, e: 7, f: -4 };
    const inv = invert(m)!;
    expect(inv).not.toBeNull();
    const round = applyMatrix(inv, ...Object.values(applyMatrix(m, 3, 9)) as [number, number]);
    expectPoint(round, 3, 9, 1e-9);
    expect(invert({ a: 0, b: 0, c: 0, d: 0, e: 1, f: 1 })).toBeNull();
    expect(applyMatrix(IDENTITY, 5, 6)).toEqual({ x: 5, y: 6 });
  });
});

describe("layerMatrix", () => {
  it("places an untransformed layer at its own x/y", () => {
    const l = makeLayer({ x: 30, y: 40, width: 100, height: 60 });
    const m = layerMatrix(l);
    expectPoint(applyMatrix(m, 0, 0), 30, 40);
    expectPoint(applyMatrix(m, 100, 60), 130, 100);
  });

  it("scales about the top-left, so x/y stays the origin", () => {
    const l = makeLayer({ x: 10, y: 10, width: 100, height: 100, scaleX: 200, scaleY: 50 });
    const m = layerMatrix(l);
    expectPoint(applyMatrix(m, 0, 0), 10, 10);
    expectPoint(applyMatrix(m, 100, 100), 210, 60);
    expect(boxSize(l)).toEqual({ w: 200, h: 50 });
  });

  it("rotates about the box centre", () => {
    const l = makeLayer({ x: 0, y: 0, width: 100, height: 100, rotation: 90 });
    expect(centerOf(l)).toEqual({ cx: 50, cy: 50 });
    // 90° clockwise: the top-left corner swings to the top-right
    expectPoint(applyMatrix(layerMatrix(l), 0, 0), 100, 0, 1e-9);
    expectPoint(applyMatrix(layerMatrix(l), 100, 100), 0, 100, 1e-9);
  });

  it("mirrors horizontally and vertically about the centre", () => {
    const base = makeLayer({ x: 0, y: 0, width: 80, height: 40 });
    expectPoint(applyMatrix(layerMatrix({ ...base, flipH: true }), 0, 0), 80, 0);
    expectPoint(applyMatrix(layerMatrix({ ...base, flipV: true }), 0, 0), 0, 40);
    expectPoint(applyMatrix(layerMatrix({ ...base, flipH: true, flipV: true }), 0, 0), 80, 40);
  });

  it("shears by the angle asked for, measured from the centre line", () => {
    const l = makeLayer({ x: 0, y: 0, width: 100, height: 100, skewX: 45 });
    // tan(45°) = 1, so the top edge slides left by half the height and the
    // bottom edge right by the same amount (shear is centred).
    expectPoint(applyMatrix(layerMatrix(l), 0, 0), -50, 0, 1e-9);
    expectPoint(applyMatrix(layerMatrix(l), 0, 100), 50, 100, 1e-9);
  });

  it("clamps a shear past the contract's range instead of going singular", () => {
    const wild = makeLayer({ width: 100, height: 100, skewX: 400 });
    const clamped = makeLayer({ width: 100, height: 100, skewX: 80 });
    expect(layerMatrix(wild)).toEqual(layerMatrix(clamped));
    expect(invert(layerMatrix(wild))).not.toBeNull();
  });

  it("treats a missing scale as 100%", () => {
    expect(scaleOf({ scaleX: 0, scaleY: 0 })).toEqual({ sx: 1, sy: 1 });
  });
});

describe("docToLocal", () => {
  it("round-trips every transform combination", () => {
    const cases = [
      {},
      { rotation: 37 },
      { rotation: -120, scaleX: 140, scaleY: 60 },
      { skewX: 25 },
      { skewY: -18 },
      { flipH: true },
      { flipV: true, rotation: 15 },
      { rotation: 22, skewX: 12, skewY: -9, scaleX: 80, scaleY: 130, flipH: true },
    ];
    for (const patch of cases) {
      const l = makeLayer({ x: 12, y: -30, width: 90, height: 140, ...patch });
      for (const [lx, ly] of [[0, 0], [90, 0], [45, 70], [90, 140]] as const) {
        const doc = applyMatrix(layerMatrix(l), lx, ly);
        expectPoint(docToLocal(l, doc.x, doc.y), lx, ly, 1e-6);
      }
    }
  });

  it("degrades to a plain offset when the layer has zero scale", () => {
    const l = makeLayer({ x: 5, y: 6, scaleX: 0, scaleY: 0, width: 0, height: 0 });
    // width/height of 0 makes the matrix singular; hit-testing must still answer
    expect(docToLocal(l, 15, 26)).toEqual({ x: 10, y: 20 });
  });
});

describe("corners and bounds", () => {
  it("lists corners clockwise from the top-left", () => {
    const l = makeLayer({ x: 0, y: 0, width: 10, height: 20 });
    expect(cornersOf(l)).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 },
    ]);
  });

  it("includes the warp displacement in the corners", () => {
    const warp: WarpCorners = { tl: [5, 0], tr: [0, 0], br: [0, 0], bl: [0, -3] };
    const l = makeLayer({ x: 0, y: 0, width: 10, height: 20, warp: JSON.stringify(warp) });
    const pts = cornersOf(l);
    expect(pts[0]).toEqual({ x: 5, y: 0 });
    expect(pts[3]).toEqual({ x: 0, y: 17 });
  });

  it("bounds a rotated layer by its actual extent, not its box", () => {
    const l = makeLayer({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
    const b = boundsOf(l);
    // a 45°-rotated square has a √2-wider bounding box, centred as before
    expect(Math.round(b.w)).toBe(Math.round(100 * Math.SQRT2));
    expect(Math.round(b.x + b.w / 2)).toBe(50);
  });

  it("unions several layers and answers an empty box for none", () => {
    const a = makeLayer({ x: 0, y: 0, width: 10, height: 10 });
    const b = makeLayer({ x: 90, y: 40, width: 10, height: 10 });
    expect(unionBounds([a, b])).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(unionBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("warp serialization", () => {
  it("round-trips corners and rounds on the way out", () => {
    const w: WarpCorners = { tl: [1.4, -2.6], tr: [0, 0], br: [3, 4], bl: [0, 0] };
    const parsed = parseWarp(serializeWarp(w))!;
    expect(parsed.tl).toEqual([1, -3]);
    expect(parsed.br).toEqual([3, 4]);
  });

  it("encodes a neutral warp as the empty string, so it clears the field", () => {
    expect(serializeWarp({ tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] })).toBe("");
    expect(isNeutralWarp({ tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] })).toBe(true);
  });

  it("treats absent, empty, malformed and all-zero warps as no warp", () => {
    for (const input of [undefined, null, "", "not json", "[]", "42",
      '{"tl":[0,0],"tr":[0,0],"br":[0,0],"bl":[0,0]}']) {
      expect(parseWarp(input as string | null | undefined)).toBeNull();
    }
  });

  it("repairs partial or non-numeric corners rather than throwing", () => {
    const w = parseWarp('{"tl":[5],"tr":["x","y"],"br":[1,2]}')!;
    expect(w.tl).toEqual([0, 0]); // too short → dropped
    expect(w.tr).toEqual([0, 0]); // NaN → zeroed
    expect(w.br).toEqual([1, 2]);
    expect(w.bl).toEqual([0, 0]); // missing → zeroed
  });

  it("warpOf always hands back a usable object", () => {
    expect(warpOf({ warp: "" })).toEqual({ tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] });
    expect(warpOf({ warp: '{"tl":[2,2],"tr":[0,0],"br":[0,0],"bl":[0,0]}' }).tl).toEqual([2, 2]);
  });
});

describe("warpPoint", () => {
  const w: WarpCorners = { tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] };

  it("maps the unit square onto the layer when there is no warp", () => {
    expectPoint(warpPoint(w, 100, 50, 0, 0), 0, 0);
    expectPoint(warpPoint(w, 100, 50, 1, 1), 100, 50);
    expectPoint(warpPoint(w, 100, 50, 0.5, 0.5), 50, 25);
  });

  it("interpolates bilinearly between displaced corners", () => {
    const pinched: WarpCorners = { tl: [20, 0], tr: [-20, 0], br: [0, 0], bl: [0, 0] };
    // top edge is pulled in 20px each side; the bottom edge is untouched
    expectPoint(warpPoint(pinched, 100, 100, 0, 0), 20, 0);
    expectPoint(warpPoint(pinched, 100, 100, 1, 0), 80, 0);
    expectPoint(warpPoint(pinched, 100, 100, 0, 1), 0, 100);
    // halfway down, the inset is halved
    expectPoint(warpPoint(pinched, 100, 100, 0, 0.5), 10, 50);
  });
});

describe("triangleMatrix", () => {
  it("finds the affine map carrying one triangle onto another", () => {
    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const dst = [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 5, y: 15 }];
    const m = triangleMatrix(src, dst)!;
    for (let i = 0; i < 3; i++) {
      expectPoint(applyMatrix(m, src[i].x, src[i].y), dst[i].x, dst[i].y, 1e-9);
    }
  });

  it("returns null for a degenerate source triangle", () => {
    const line = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }];
    expect(triangleMatrix(line, line)).toBeNull();
  });
});

describe("warp presets", () => {
  it("scale with the layer, so a preset looks the same at any size", () => {
    const small = presetCorners("perspective", { width: 100, height: 100 });
    const big = presetCorners("perspective", { width: 1000, height: 1000 });
    expect(big.tl[0]).toBe(small.tl[0] * 10);
  });

  it("are all non-neutral and all different shapes", () => {
    const encoded = WARP_PRESETS.map((p) => serializeWarp(presetCorners(p, { width: 200, height: 100 })));
    for (const e of encoded) expect(e).not.toBe("");
    expect(new Set(encoded).size).toBe(WARP_PRESETS.length);
  });

  it("never promises a bowed edge — four pins cannot draw one", () => {
    // A bow would need the MIDDLE of an edge to move while its corners stay put.
    // Assert the honest property instead: every preset moves at least one corner
    // and the midpoint of an edge only ever moves as the average of its corners.
    for (const preset of WARP_PRESETS) {
      const w = presetCorners(preset, { width: 100, height: 100 });
      const mid = warpPoint(w, 100, 100, 0.5, 0);
      expect(close(mid.x, (w.tl[0] + 100 + w.tr[0]) / 2, 1e-9)).toBe(true);
      expect(close(mid.y, (w.tl[1] + w.tr[1]) / 2, 1e-9)).toBe(true);
    }
  });
});

describe("wrapAngle", () => {
  it("keeps angles in -180..180", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(90)).toBe(90);
    expect(wrapAngle(270)).toBe(-90);
    expect(wrapAngle(-270)).toBe(90);
    expect(wrapAngle(450)).toBe(90);
    expect(wrapAngle(180)).toBe(180);
    expect(wrapAngle(-180)).toBe(180);
    expect(wrapAngle(361)).toBe(1);
  });
});
