import { describe, it, expect } from "vitest";
import { applyFilter } from "./filters";
import { createCanvas, ctx2d } from "./raster";
import { drawCalls, readPixel, seedPixels } from "../test/canvasStub";
import { FILTERS, type FilterKind } from "../types";

function seeded(rgba: [number, number, number, number], w = 4, h = 4): HTMLCanvasElement {
  const c = createCanvas(w, h);
  ctx2d(c); // create the context so the stub buffer exists
  seedPixels(c, rgba);
  return c;
}

describe("applyFilter", () => {
  it("covers every filter the Filter menu offers", () => {
    const src = seeded([120, 90, 60, 255]);
    for (const { kind } of FILTERS) {
      const out = applyFilter(src, kind);
      expect([out.width, out.height], `${kind} changed the canvas size`).toEqual([4, 4]);
    }
  });

  it("never mutates its source", () => {
    const src = seeded([10, 20, 30, 255]);
    applyFilter(src, "invert");
    expect(readPixel(src)).toEqual([10, 20, 30, 255]);
  });

  it("returns a different canvas object each time", () => {
    const src = seeded([10, 20, 30, 255]);
    const a = applyFilter(src, "blur");
    const b = applyFilter(src, "blur");
    expect(a).not.toBe(src);
    expect(a).not.toBe(b);
  });

  // ── The CSS-filter family ─────────────────────────────────────────────────
  // blur/grayscale/sepia/invert/brighten/darken hand the work to the 2D context's
  // `filter` property, which no stub can evaluate — that is the browser's
  // arithmetic, and the Playwright suite is where it gets checked. What IS worth
  // pinning here is that each one asks for the right filter, since a typo in a
  // filter string fails silently and looks like "the filter did nothing".
  it.each([
    ["blur", "blur(2.5px)"],
    ["grayscale", "grayscale(1)"],
    ["sepia", "sepia(1)"],
    ["invert", "invert(1)"],
    ["brighten", "brightness(1.18)"],
    ["darken", "brightness(0.82)"],
  ] as const)("%s asks the context for %s", (kind, expected) => {
    const out = applyFilter(seeded([120, 120, 120, 255]), kind);
    const draw = drawCalls(out).find((c) => c.kind === "drawImage");
    expect(draw?.filter).toBe(expected);
  });

  // ── The JS-implemented family ─────────────────────────────────────────────
  // These run real per-pixel arithmetic through getImageData/putImageData, so the
  // stub's buffer makes them genuinely verifiable.
  it("sharpen runs its convolution and preserves alpha", () => {
    // A flat field is its own sharpened self (the kernel sums to 1), which is
    // exactly the invariant worth pinning: no drift, no alpha damage.
    const out = applyFilter(seeded([100, 150, 200, 128], 4, 4), "sharpen");
    expect(readPixel(out, 2, 2)).toEqual([100, 150, 200, 128]);
  });

  it("noise perturbs colour but never alpha", () => {
    const out = applyFilter(seeded([100, 100, 100, 255], 8, 8), "noise");
    let moved = 0;
    for (let x = 0; x < 8; x++) {
      const [r, , , a] = readPixel(out, x, 0);
      expect(a).toBe(255);
      if (r !== 100) moved += 1;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it("noise leaves fully transparent pixels untouched", () => {
    const out = applyFilter(seeded([0, 0, 0, 0], 4, 4), "noise");
    expect(readPixel(out)).toEqual([0, 0, 0, 0]);
  });

  it("pixelate keeps the canvas size while resampling", () => {
    const out = applyFilter(seeded([1, 2, 3, 255], 32, 32), "pixelate");
    expect([out.width, out.height]).toEqual([32, 32]);
  });

  it("motion blur stacks alpha-weighted copies across the width", () => {
    const src = seeded([10, 20, 30, 255], 64, 8);
    const out = applyFilter(src, "motion-blur");
    const draws = drawCalls(out).filter((c) => c.kind === "drawImage");
    expect(draws.length).toBeGreaterThan(2);
    expect(draws[0].globalAlpha).toBeLessThan(1);
  });

  it("falls back to a copy for an unknown kind instead of throwing", () => {
    const src = seeded([9, 9, 9, 255]);
    const out = applyFilter(src, "not-a-filter" as FilterKind);
    expect([out.width, out.height]).toEqual([4, 4]);
  });

  it("handles a 1×1 canvas, where a convolution has no neighbours", () => {
    const out = applyFilter(seeded([50, 60, 70, 255], 1, 1), "sharpen");
    expect([out.width, out.height]).toEqual([1, 1]);
  });
});
