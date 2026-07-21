import { describe, expect, it } from "vitest";
import { paintLuma, rgbaToLuma } from "./luma";

// jsdom does not implement a real canvas 2D context, so we exercise the PURE
// pixel math directly: rgbaToLuma only reads {data,width,height}, and paintLuma
// only needs createImageData/putImageData — both easy to stand in for.

/** Build an ImageData-shaped object from flat RGBA bytes (no jsdom dependency). */
function fakeImageData(width: number, height: number, rgba: number[]): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(rgba),
    colorSpace: "srgb",
  } as ImageData;
}

/** A minimal 2D-context stand-in capturing putImageData for round-trip asserts. */
function fakeCtx(): {
  ctx: CanvasRenderingContext2D;
  last: () => { width: number; height: number; data: Uint8ClampedArray } | null;
} {
  let painted: { width: number; height: number; data: Uint8ClampedArray } | null = null;
  const ctx = {
    createImageData(width: number, height: number) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
        colorSpace: "srgb",
      } as ImageData;
    },
    putImageData(img: ImageData) {
      painted = { width: img.width, height: img.height, data: img.data };
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, last: () => painted };
}

describe("rgbaToLuma (integer Rec.601 grayscale)", () => {
  it("maps pure white and pure black exactly", () => {
    const img = fakeImageData(2, 1, [255, 255, 255, 255, 0, 0, 0, 255]);
    const luma = rgbaToLuma(img);
    expect(luma.length).toBe(2);
    // (77+150+29)*255 >> 8 = 256*255 >> 8 = 255
    expect(luma[0]).toBe(255);
    expect(luma[1]).toBe(0);
  });

  it("uses the exact integer weights (77R + 150G + 29B) >> 8", () => {
    // Pure red / green / blue channels at full intensity.
    const img = fakeImageData(3, 1, [
      255, 0, 0, 255, // red   → 77*255 >> 8
      0, 255, 0, 255, // green → 150*255 >> 8
      0, 0, 255, 255, // blue  → 29*255 >> 8
    ]);
    const luma = rgbaToLuma(img);
    expect(luma[0]).toBe((77 * 255) >> 8); // 76
    expect(luma[1]).toBe((150 * 255) >> 8); // 149
    expect(luma[2]).toBe((29 * 255) >> 8); // 28
  });

  it("produces exactly width*height samples", () => {
    const img = fakeImageData(4, 3, new Array(4 * 3 * 4).fill(128));
    expect(rgbaToLuma(img).length).toBe(12);
  });

  it("ignores the alpha channel", () => {
    const opaque = fakeImageData(1, 1, [100, 100, 100, 255]);
    const transparent = fakeImageData(1, 1, [100, 100, 100, 0]);
    expect(rgbaToLuma(opaque)[0]).toBe(rgbaToLuma(transparent)[0]);
  });
});

describe("paintLuma (luma → grayscale RGBA)", () => {
  it("expands each luma sample to opaque R=G=B and blits it", () => {
    const { ctx, last } = fakeCtx();
    const pixels = [0, 64, 128, 255];
    paintLuma(ctx, 2, 2, pixels);
    const out = last();
    expect(out).not.toBeNull();
    expect(out!.width).toBe(2);
    expect(out!.height).toBe(2);
    for (let p = 0; p < pixels.length; p++) {
      const i = p * 4;
      expect(out!.data[i]).toBe(pixels[p]);
      expect(out!.data[i + 1]).toBe(pixels[p]);
      expect(out!.data[i + 2]).toBe(pixels[p]);
      expect(out!.data[i + 3]).toBe(255); // fully opaque
    }
  });

  it("round-trips a grayscale buffer: paint then read back the luma", () => {
    const { ctx, last } = fakeCtx();
    const original = [10, 20, 30, 40, 50, 60];
    paintLuma(ctx, 3, 2, original);
    // Reading the painted RGBA back through rgbaToLuma must recover the input
    // (R=G=B=v ⇒ (77+150+29)*v >> 8 = v exactly).
    const recovered = rgbaToLuma(last()! as ImageData);
    expect(Array.from(recovered)).toEqual(original);
  });

  it("defaults missing pixels to 0 (short/partial buffer never throws)", () => {
    const { ctx, last } = fakeCtx();
    paintLuma(ctx, 2, 1, [200]); // only 1 of 2 pixels provided
    const out = last();
    expect(out!.data[0]).toBe(200);
    expect(out!.data[4]).toBe(0); // second pixel padded to black
  });
});
