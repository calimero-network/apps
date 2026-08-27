// Pixel-level tests for the raster engine.
//
// Split from raster.test.ts (which covers the pure string/number helpers) because
// everything here leans on the canvas stub's real pixel buffer — see
// src/test/canvasStub.ts for what that can and cannot model.

import { describe, it, expect } from "vitest";
import {
  applyCurves, applyLevels, createCanvas, ctx2d, floodFill, NEUTRAL_LEVELS,
  renderTextLayer, type CurvesData,
} from "./raster";
import { drawCalls, readPixel, seedPixels } from "../test/canvasStub";
import { makeLayer } from "../test/factories";

function seeded(rgba: [number, number, number, number], w = 4, h = 4): HTMLCanvasElement {
  const c = createCanvas(w, h);
  ctx2d(c);
  seedPixels(c, rgba);
  return c;
}

describe("createCanvas", () => {
  it("rounds and floors dimensions to at least one pixel", () => {
    expect([createCanvas(10.4, 20.6).width, createCanvas(10.4, 20.6).height]).toEqual([10, 21]);
    expect(createCanvas(0, 0).width).toBe(1);
    expect(createCanvas(-5, -5).height).toBe(1);
  });
});

describe("applyCurves", () => {
  const ramp = (from: number, to: number): CurvesData => ({ rgb: [{ x: 0, y: from }, { x: 255, y: to }] });

  it("leaves pixels alone under an identity curve", () => {
    const out = applyCurves(seeded([10, 120, 240, 255]), ramp(0, 255));
    expect(readPixel(out)).toEqual([10, 120, 240, 255]);
  });

  it("inverts under a descending curve", () => {
    const out = applyCurves(seeded([0, 128, 255, 255]), ramp(255, 0));
    const [r, g, b] = readPixel(out);
    expect(r).toBe(255);
    expect(g).toBeCloseTo(127, 0);
    expect(b).toBe(0);
  });

  it("applies per-channel curves on top of the composite one", () => {
    const out = applyCurves(seeded([100, 100, 100, 255]), {
      rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      r: [{ x: 0, y: 255 }, { x: 255, y: 255 }], // red pinned high
    });
    const [r, g] = readPixel(out);
    expect(r).toBe(255);
    expect(g).toBe(100);
  });

  it("clamps a curve that only covers part of the range", () => {
    // Control points from 64..192 only: below/above must hold their end values.
    const out = applyCurves(seeded([0, 255, 128, 255]), {
      rgb: [{ x: 64, y: 0 }, { x: 192, y: 255 }],
    });
    const [r, g] = readPixel(out);
    expect(r).toBe(0);
    expect(g).toBe(255);
  });

  it("never touches alpha", () => {
    const out = applyCurves(seeded([10, 10, 10, 77]), ramp(255, 0));
    expect(readPixel(out)[3]).toBe(77);
  });

  it("returns a new canvas and leaves the source alone", () => {
    const src = seeded([10, 10, 10, 255]);
    const out = applyCurves(src, ramp(255, 0));
    expect(out).not.toBe(src);
    expect(readPixel(src)).toEqual([10, 10, 10, 255]);
  });
});

describe("applyLevels", () => {
  it("is a no-op at neutral settings", () => {
    const out = applyLevels(seeded([33, 66, 99, 255]), NEUTRAL_LEVELS);
    expect(readPixel(out)).toEqual([33, 66, 99, 255]);
  });

  it("clips everything below the input black point", () => {
    const out = applyLevels(seeded([40, 40, 40, 255]), { ...NEUTRAL_LEVELS, inBlack: 80 });
    expect(readPixel(out)[0]).toBe(0);
  });

  it("clips everything above the input white point", () => {
    const out = applyLevels(seeded([200, 200, 200, 255]), { ...NEUTRAL_LEVELS, inWhite: 150 });
    expect(readPixel(out)[0]).toBe(255);
  });

  it("brightens midtones with gamma above 1", () => {
    const src = seeded([128, 128, 128, 255]);
    const out = applyLevels(src, { ...NEUTRAL_LEVELS, gamma: 2 });
    expect(readPixel(out)[0]).toBeGreaterThan(128);
  });

  it("compresses into the output range", () => {
    const out = applyLevels(seeded([255, 255, 255, 255]), { ...NEUTRAL_LEVELS, outWhite: 128 });
    expect(readPixel(out)[0]).toBe(128);
  });

  it("survives an inverted input range instead of dividing by zero", () => {
    const out = applyLevels(seeded([100, 100, 100, 255]), { ...NEUTRAL_LEVELS, inBlack: 200, inWhite: 50 });
    const [r] = readPixel(out);
    expect(Number.isFinite(r)).toBe(true);
  });
});

describe("floodFill", () => {
  function grid(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = createCanvas(w, h);
    const ctx = ctx2d(canvas);
    seedPixels(canvas, [0, 0, 0, 255]);
    return { canvas, ctx };
  }

  it("fills a uniform region", () => {
    const { canvas, ctx } = grid(4, 4);
    floodFill(ctx, 0, 0, [255, 0, 0, 255], 0);
    expect(readPixel(canvas, 3, 3)).toEqual([255, 0, 0, 255]);
  });

  it("ignores a start point outside the canvas", () => {
    const { canvas, ctx } = grid(4, 4);
    floodFill(ctx, 99, 99, [255, 0, 0, 255], 0);
    expect(readPixel(canvas)).toEqual([0, 0, 0, 255]);
  });

  it("stops at a colour boundary once tolerance is exceeded", () => {
    const { canvas, ctx } = grid(4, 1);
    // paint a wall at x=2 by writing straight into the buffer
    const img = ctx.getImageData(0, 0, 4, 1);
    img.data[2 * 4] = 200; img.data[2 * 4 + 1] = 200; img.data[2 * 4 + 2] = 200;
    ctx.putImageData(img, 0, 0);

    floodFill(ctx, 0, 0, [255, 0, 0, 255], 10);
    expect(readPixel(canvas, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(readPixel(canvas, 3, 0)).toEqual([0, 0, 0, 255]); // beyond the wall
  });

  it("crosses the same boundary when tolerance is wide enough", () => {
    const { canvas, ctx } = grid(4, 1);
    const img = ctx.getImageData(0, 0, 4, 1);
    img.data[2 * 4] = 20; img.data[2 * 4 + 1] = 20; img.data[2 * 4 + 2] = 20;
    ctx.putImageData(img, 0, 0);
    floodFill(ctx, 0, 0, [255, 0, 0, 255], 64);
    expect(readPixel(canvas, 3, 0)).toEqual([255, 0, 0, 255]);
  });

  it("respects an in/out mask, which a clip path cannot do here", () => {
    // The bucket mutates ImageData directly, so a selection has to arrive as a
    // mask — this is the test that stops that regressing.
    const { canvas, ctx } = grid(4, 1);
    const mask = new Uint8Array([1, 1, 0, 0]);
    floodFill(ctx, 0, 0, [255, 0, 0, 255], 0, mask);
    expect(readPixel(canvas, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(readPixel(canvas, 2, 0)).toEqual([0, 0, 0, 255]);
  });

  it("does nothing when the start point is outside the mask", () => {
    const { canvas, ctx } = grid(4, 1);
    floodFill(ctx, 0, 0, [255, 0, 0, 255], 0, new Uint8Array([0, 1, 1, 1]));
    expect(readPixel(canvas, 1, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe("renderTextLayer", () => {
  const textLayer = (patch: Partial<Parameters<typeof makeLayer>[0]> = {}) =>
    makeLayer({
      kind: "text", width: 200, height: 80,
      text: { content: "Hi", fontFamily: "Inter", fontSize: 40, color: "#ff0000", bold: true, italic: false },
      ...patch,
    });

  it("renders at the layer's own size", () => {
    const c = renderTextLayer(textLayer());
    expect([c.width, c.height]).toEqual([200, 80]);
  });

  it("builds a font string from the layer's typography", () => {
    const c = renderTextLayer(textLayer({
      text: { content: "x", fontFamily: "Georgia", fontSize: 24, color: "#fff", bold: false, italic: true },
    }));
    // the font is set before the fill, so it is observable on the recorded call
    expect(drawCalls(c).some((call) => call.kind === "fillText")).toBe(true);
  });

  it("draws one line per newline", () => {
    const c = renderTextLayer(textLayer({
      text: { content: "a\nb\nc", fontFamily: "Inter", fontSize: 20, color: "#fff", bold: false, italic: false },
    }));
    expect(drawCalls(c).filter((call) => call.kind === "fillText")).toHaveLength(3);
  });

  it("returns a blank canvas for a layer with no text props", () => {
    const c = renderTextLayer(makeLayer({ kind: "text", text: null, width: 30, height: 10 }));
    expect([c.width, c.height]).toEqual([30, 10]);
    expect(drawCalls(c).filter((call) => call.kind === "fillText")).toHaveLength(0);
  });

  it("never produces a zero-size canvas", () => {
    const c = renderTextLayer(makeLayer({ kind: "text", width: 0, height: 0, text: null }));
    expect([c.width, c.height]).toEqual([1, 1]);
  });
});
