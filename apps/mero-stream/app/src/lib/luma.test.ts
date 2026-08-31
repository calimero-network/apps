import { describe, expect, it } from "vitest";
import { captureFrameLuma, paintLuma, rgbaToLuma } from "./luma";

// jsdom does not implement a real canvas 2D context, so we exercise the PURE
// pixel math directly: rgbaToLuma only reads {data,width,height}, and paintLuma
// only needs createImageData/putImageData — both easy to stand in for.

/** Build an ImageData-shaped object from flat RGBA bytes (no jsdom dependency). */
function fakeImageData(
  width: number,
  height: number,
  rgba: number[],
): ImageData {
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
  let painted: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null = null;
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
      255,
      0,
      0,
      255, // red   → 77*255 >> 8
      0,
      255,
      0,
      255, // green → 150*255 >> 8
      0,
      0,
      255,
      255, // blue  → 29*255 >> 8
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

// ── captureFrameLuma: the send side ──────────────────────────────────────────
//
// jsdom has no real canvas, but captureFrameLuma only needs drawImage +
// getImageData, so a recording stand-in exercises the whole function. This is
// the one part of the media path that decides HOW MUCH data enters the contract
// per frame, and it was untested.

/** A canvas stand-in that records the downscale target and serves fixed pixels. */
function fakeCanvas(fill: (w: number, h: number) => Uint8ClampedArray) {
  const calls: { drawImage: unknown[][]; getImageData: number[][] } = {
    drawImage: [],
    getImageData: [],
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(kind: string, opts?: unknown) {
      calls.drawImage.push([kind, opts]);
      return {
        drawImage: (...args: unknown[]) => calls.drawImage.push(args),
        getImageData: (x: number, y: number, w: number, h: number) => {
          calls.getImageData.push([x, y, w, h]);
          return {
            width: w,
            height: h,
            data: fill(w, h),
            colorSpace: "srgb",
          } as ImageData;
        },
      };
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const fakeVideo = {} as HTMLVideoElement;

describe("captureFrameLuma (video → downscale → luma)", () => {
  it("resizes the scratch canvas to the requested geometry, not the video's", () => {
    // Geometry is the primary knob on the Task-3 load curve, so the capture must
    // land on exactly the requested size — a canvas left at the webcam's native
    // resolution would silently push ~500x more bytes per frame.
    const { canvas } = fakeCanvas((w, h) => new Uint8ClampedArray(w * h * 4));
    captureFrameLuma(fakeVideo, canvas, 64, 48);
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(48);
  });

  it("returns exactly width*height luma bytes", () => {
    const { canvas } = fakeCanvas((w, h) => new Uint8ClampedArray(w * h * 4));
    const out = captureFrameLuma(fakeVideo, canvas, 64, 48);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(64 * 48);
  });

  it("draws with an explicit destination size (that is what downscales)", () => {
    const { canvas, calls } = fakeCanvas(
      (w, h) => new Uint8ClampedArray(w * h * 4),
    );
    captureFrameLuma(fakeVideo, canvas, 32, 24);
    const draw = calls.drawImage.find((c) => c[0] === fakeVideo);
    expect(draw).toEqual([fakeVideo, 0, 0, 32, 24]);
    expect(calls.getImageData.at(-1)).toEqual([0, 0, 32, 24]);
  });

  it("requests willReadFrequently (getImageData runs every capture tick)", () => {
    const { canvas, calls } = fakeCanvas(
      (w, h) => new Uint8ClampedArray(w * h * 4),
    );
    captureFrameLuma(fakeVideo, canvas, 8, 8);
    expect(calls.drawImage[0]).toEqual(["2d", { willReadFrequently: true }]);
  });

  it("converts the drawn pixels through the same integer luma weights", () => {
    // Fill with a known colour and check the returned byte matches rgbaToLuma —
    // proves capture and paint cannot drift apart.
    const { canvas } = fakeCanvas((w, h) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 10;
        d[i + 1] = 200;
        d[i + 2] = 30;
        d[i + 3] = 255;
      }
      return d;
    });
    const out = captureFrameLuma(fakeVideo, canvas, 4, 4);
    const expected = (77 * 10 + 150 * 200 + 29 * 30) >> 8;
    expect([...out]).toEqual(Array(16).fill(expected));
  });

  it("throws a clear error when the 2D context is unavailable", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(() => captureFrameLuma(fakeVideo, canvas, 8, 8)).toThrow(
      /2D canvas context/,
    );
  });
});
