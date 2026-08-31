import { describe, it, expect } from "vitest";
import { isPaintable } from "./color";

/**
 * `"transparent"` being truthy is why `el.stroke || "#000"` never fell back, which
 * is the shared root cause behind invisible lines and dead stroke on text/images.
 */
describe("isPaintable", () => {
  it("accepts real colours", () => {
    for (const c of ["#000000", "#FFF", "red", "rgb(1,2,3)", "rgba(0,0,0,0.5)"]) {
      expect(isPaintable(c)).toBe(true);
    }
  });

  it("rejects the values that look truthy but paint nothing", () => {
    for (const c of ["transparent", "TRANSPARENT", " transparent ", "none", "rgba(0,0,0,0)"]) {
      expect(isPaintable(c)).toBe(false);
    }
  });

  it("rejects empty and nullish", () => {
    for (const c of ["", "   ", null, undefined]) {
      expect(isPaintable(c)).toBe(false);
    }
  });
});
