import { describe, it, expect } from "vitest";
import {
  adjustmentsToFilter, hasFilterAdjustments, hexToRgb, rgbToHex, clamp,
  blendOp, parseCurves, isIdentityCurves,
} from "./raster";
import { NEUTRAL_ADJUSTMENTS, type Adjustments } from "../types";

describe("adjustmentsToFilter", () => {
  it("returns 'none' for neutral adjustments", () => {
    expect(adjustmentsToFilter(NEUTRAL_ADJUSTMENTS)).toBe("none");
    expect(hasFilterAdjustments(NEUTRAL_ADJUSTMENTS)).toBe(false);
  });

  it("maps brightness/contrast/saturation/hue/blur/invert to CSS filters", () => {
    const adj: Adjustments = { ...NEUTRAL_ADJUSTMENTS, brightness: 50, contrast: 20, saturation: -100, hue: 90, blur: 3, invert: true };
    const f = adjustmentsToFilter(adj);
    expect(f).toContain("brightness(");
    expect(f).toContain("contrast(");
    expect(f).toContain("saturate(");
    expect(f).toContain("hue-rotate(90deg)");
    expect(f).toContain("blur(3px)");
    expect(f).toContain("invert(1)");
    expect(hasFilterAdjustments(adj)).toBe(true);
  });

  it("folds exposure into brightness", () => {
    const adj: Adjustments = { ...NEUTRAL_ADJUSTMENTS, exposure: 100 };
    expect(adjustmentsToFilter(adj)).toContain("brightness(2");
  });
});

describe("color conversion", () => {
  it("round-trips hex <-> rgb", () => {
    expect(hexToRgb("#ff8800")).toEqual([255, 136, 0]);
    expect(rgbToHex(255, 136, 0)).toBe("#ff8800");
  });
  it("expands shorthand hex", () => {
    expect(hexToRgb("#abc")).toEqual([0xaa, 0xbb, 0xcc]);
  });
  it("clamps out-of-range channels on encode", () => {
    expect(rgbToHex(300, -10, 128)).toBe("#ff0080");
  });
});

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("blendOp", () => {
  it("maps known modes and falls back to source-over", () => {
    expect(blendOp("multiply")).toBe("multiply");
    expect(blendOp("normal")).toBe("source-over");
    expect(blendOp("luminosity")).toBe("luminosity");
  });
});

describe("curves parsing", () => {
  it("parses valid JSON and rejects garbage", () => {
    expect(parseCurves(undefined)).toBeNull();
    expect(parseCurves("not json")).toBeNull();
    const c = parseCurves(JSON.stringify({ rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }] }));
    expect(c?.rgb?.length).toBe(2);
  });
  it("detects identity curves", () => {
    expect(isIdentityCurves(null)).toBe(true);
    expect(isIdentityCurves({ rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }] })).toBe(true);
    expect(isIdentityCurves({ rgb: [{ x: 0, y: 40 }, { x: 255, y: 255 }] })).toBe(false);
  });
});
