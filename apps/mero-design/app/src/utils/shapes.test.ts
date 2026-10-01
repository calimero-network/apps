import { describe, expect, it } from "vitest";
import { dashArray, inkFor, shapeDefaults, shapePath, SHAPE_KINDS, strokeCap } from "./shapes";

/** Bounds of every coordinate in a path made of M/L/Z commands. */
function bounds(d: string) {
  const nums = d.replace(/[MLZ]/g, " ").trim().split(/\s+/).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe("shapePath", () => {
  it.each(SHAPE_KINDS)("%s fills its box exactly, so a save never shrinks it", (kind) => {
    for (const [w, h] of [[120, 80], [37, 211], [1, 1]]) {
      const b = bounds(shapePath(kind, w, h));
      expect(b.minX).toBeCloseTo(0, 1);
      expect(b.minY).toBeCloseTo(0, 1);
      expect(b.maxX).toBeCloseTo(w, 1);
      expect(b.maxY).toBeCloseTo(h, 1);
    }
  });

  it("every outline is closed, so it can be filled", () => {
    for (const kind of SHAPE_KINDS) expect(shapePath(kind, 50, 50).trim().endsWith("Z")).toBe(true);
  });

  it("a star has ten points and a cloud is a smooth dense outline", () => {
    expect(shapePath("star", 100, 100).match(/[ML]/g)).toHaveLength(10);
    expect(shapePath("cloud", 100, 60).match(/[ML]/g)!.length).toBeGreaterThan(100);
  });
});

describe("stroke styles", () => {
  it("solid has no dash pattern", () => {
    expect(dashArray("solid", 4)).toBeUndefined();
    expect(dashArray(undefined, 4)).toBeUndefined();
  });

  it("patterns scale with the stroke width", () => {
    expect(dashArray("dashed", 4)).toEqual([12, 8]);
    expect(dashArray("dashed", 1)).toEqual([3, 2]);
  });

  it("dotted and triple-dot are zero-length dashes that need a round cap", () => {
    expect(dashArray("dotted", 4)).toEqual([0, 8]);
    expect(dashArray("dotted3", 2)!.filter((n) => n === 0)).toHaveLength(3);
    expect(strokeCap("dotted")).toBe("round");
    expect(strokeCap("dotted3")).toBe("round");
    expect(strokeCap("dashed")).toBe("butt");
  });
});

describe("new shapes start as outlines (item 1)", () => {
  it.each(["rect", "rounded", "circle", "triangle", "diamond", "star", "cloud"])("%s: no fill, 4px stroke", (tool) => {
    const d = shapeDefaults(tool);
    expect(d.fill).toBe("transparent");
    expect(d.strokeWidth).toBe(4);
    expect(d.stroke).toMatch(/^#/);
  });

  it("rounded rectangle is a rect with a corner radius; the path shapes carry their shape", () => {
    expect(shapeDefaults("rounded")).toMatchObject({ kind: "rect", cornerRadius: 16 });
    expect(shapeDefaults("star")).toMatchObject({ kind: "path", shape: "star" });
    expect(shapeDefaults("circle").kind).toBe("circle");
  });
});

describe("inkFor", () => {
  it("dark text on light fills and on no fill, white on dark", () => {
    expect(inkFor("#FFE27A")).toBe("#1e1e1e");
    expect(inkFor(null)).toBe("#1e1e1e");
    expect(inkFor("#1971c2")).toBe("#ffffff");
    expect(inkFor("#000")).toBe("#ffffff");
  });
});
