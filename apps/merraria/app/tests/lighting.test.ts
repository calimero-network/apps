import { describe, expect, it } from "vitest";
import { LightGrid } from "../src/engine/lighting";
import { STONE, TORCH } from "../src/engine/tiles";
import { TileStore } from "../src/engine/world";

describe("2D lighting", () => {
  it("open sky columns are fully lit down to the first opaque tile", () => {
    const w = new TileStore();
    for (let x = 0; x < 40; x++) w.setGenerated(x, 100, STONE);
    const l = new LightGrid();
    l.recompute(w);
    expect(l.skyAt(10, 0)).toBe(15);
    expect(l.skyAt(10, 99)).toBe(15);
    expect(l.skyAt(10, 101)).toBeLessThan(15); // below the floor: shaded
  });

  it("caves are dark until you get near the entrance", () => {
    const w = new TileStore();
    // seal a 20-wide cave under a stone roof at y=50, open at x=30
    for (let x = 10; x < 30; x++) w.setGenerated(x, 50, STONE);
    const l = new LightGrid();
    l.recompute(w);
    expect(l.skyAt(11, 51)).toBeLessThan(15); // under the roof
    expect(l.skyAt(29, 51)).toBeGreaterThan(10); // near the open edge
    // deep under the middle of the roof it is darker than near the edge
    expect(l.skyAt(20, 51)).toBeLessThan(l.skyAt(28, 51));
  });

  it("torch light falls off by 1 per step and ignores day factor", () => {
    const w = new TileStore();
    // sealed box so no sky light interferes
    for (let x = 95; x <= 115; x++) {
      w.setGenerated(x, 95, STONE);
      w.setGenerated(x, 115, STONE);
    }
    for (let y = 95; y <= 115; y++) {
      w.setGenerated(95, y, STONE);
      w.setGenerated(115, y, STONE);
    }
    w.setGenerated(105, 105, TORCH);
    const l = new LightGrid();
    l.recompute(w);
    expect(l.blockAt(105, 105)).toBe(14);
    expect(l.blockAt(108, 105)).toBe(11);
    expect(l.brightness(105, 105, 0.08)).toBeGreaterThan(0.7); // night: torch still bright
  });

  it("recompute clears the dirty flag", () => {
    const w = new TileStore();
    w.setTile(5, 5, STONE);
    expect(w.lightDirty).toBe(true);
    const l = new LightGrid();
    l.recompute(w);
    expect(w.lightDirty).toBe(false);
  });

  it("brightness is clamped to a visible minimum", () => {
    const w = new TileStore();
    const l = new LightGrid();
    l.recompute(w);
    expect(l.brightness(0, 199, 0.08)).toBeGreaterThan(0);
  });
});
