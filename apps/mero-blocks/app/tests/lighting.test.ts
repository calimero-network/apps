import { describe, expect, it } from "vitest";
import { GLOWSTONE, STONE, TORCH } from "../src/engine/blocks";
import { LightGrid } from "../src/engine/lighting";
import { WorldStore } from "../src/engine/world";

describe("lighting", () => {
  it("an empty world is fully sunlit", () => {
    const w = new WorldStore();
    const l = new LightGrid();
    l.recomputeAll(w);
    expect(l.sunAt(10, 10, 10)).toBe(15);
    expect(l.sunAt(0, 0, 0)).toBe(15);
    expect(l.blockAt(10, 10, 10)).toBe(0);
  });

  it("sunlight is blocked below an opaque block and spreads back in from the sides", () => {
    const w = new WorldStore();
    // 5x5 platform at y=30, x/z in 10..14
    for (let x = 10; x <= 14; x++) for (let z = 10; z <= 14; z++) w.setGenerated(x, 30, z, STONE);
    const l = new LightGrid();
    l.recomputeAll(w);
    expect(l.sunAt(12, 31, 12)).toBe(15); // above: full sun
    expect(l.sunAt(12, 29, 12)).toBe(12); // center under: 15 - 3 side steps
    expect(l.sunAt(10, 29, 10)).toBe(14); // corner under: 1 step from open air on two sides
    expect(l.sunAt(9, 29, 12)).toBe(15); // beside the platform
  });

  it("torch light falls off by 1 per step", () => {
    const w = new WorldStore();
    w.setGenerated(20, 20, 20, TORCH); // emissive 14
    const l = new LightGrid();
    l.recomputeAll(w);
    expect(l.blockAt(20, 20, 20)).toBe(14);
    expect(l.blockAt(21, 20, 20)).toBe(13);
    expect(l.blockAt(25, 20, 20)).toBe(9);
    expect(l.blockAt(20 + 14, 20, 20)).toBe(0);
  });

  it("glowstone (15) outshines a torch (14)", () => {
    const w = new WorldStore();
    w.setGenerated(20, 20, 20, GLOWSTONE);
    const l = new LightGrid();
    l.recomputeAll(w);
    expect(l.blockAt(20, 20, 20)).toBe(15);
    expect(l.blockAt(23, 20, 20)).toBe(12);
  });

  it("block light does not pass through opaque walls", () => {
    const w = new WorldStore();
    w.setGenerated(20, 20, 20, TORCH);
    // wall at x=22 spanning a wide area
    for (let y = 15; y <= 25; y++) for (let z = 15; z <= 25; z++) w.setGenerated(22, y, z, STONE);
    const l = new LightGrid();
    l.recomputeAll(w);
    // directly behind the wall: light must wrap around (longer path), not pierce
    const direct = 14 - 3; // would be 11 if the wall were transparent
    expect(l.blockAt(23, 20, 20)).toBeLessThan(direct);
  });

  it("relightAround updates after placing and breaking a torch", () => {
    const w = new WorldStore();
    const l = new LightGrid();
    l.recomputeAll(w);

    w.setBlock(30, 20, 30, TORCH);
    l.relightAround(w, 30, 30);
    expect(l.blockAt(31, 20, 30)).toBe(13);

    w.setBlock(30, 20, 30, 0);
    l.relightAround(w, 30, 30);
    expect(l.blockAt(31, 20, 30)).toBe(0);
  });

  it("relightAround restores the sun column after breaking a roof block", () => {
    const w = new WorldStore();
    for (let x = 40; x <= 44; x++) for (let z = 40; z <= 44; z++) w.setGenerated(x, 30, z, STONE);
    const l = new LightGrid();
    l.recomputeAll(w);
    expect(l.sunAt(42, 20, 42)).toBeLessThan(15);

    w.setBlock(42, 30, 42, 0); // break the center roof block
    l.relightAround(w, 42, 42);
    expect(l.sunAt(42, 20, 42)).toBe(15); // full column restored to bedrock-ish depth
  });

  it("reports changed chunks for remeshing", () => {
    const w = new WorldStore();
    const l = new LightGrid();
    l.recomputeAll(w);
    l.takeChangedChunks();

    w.setBlock(8, 8, 8, TORCH);
    l.relightAround(w, 8, 8);
    const changed = l.takeChangedChunks();
    expect(changed).toContain("0,0,0");
    expect(l.takeChangedChunks()).toEqual([]);
  });
});
