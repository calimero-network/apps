import { describe, expect, it } from "vitest";
import { GLASS, LEAVES, STONE, TORCH, WATER } from "../src/engine/blocks";
import { LightGrid } from "../src/engine/lighting";
import { buildChunkMesh } from "../src/engine/mesher";
import { WorldStore } from "../src/engine/world";

const meshAt = (w: WorldStore) => {
  const light = new LightGrid();
  light.recomputeAll(w);
  return buildChunkMesh(w, light, 0, 0, 0);
};

describe("chunk mesher", () => {
  it("a lone cube has exactly 6 faces", () => {
    const w = new WorldStore();
    w.setGenerated(8, 8, 8, STONE);
    const { opaque, translucent } = meshAt(w);
    expect(opaque.faceCount).toBe(6);
    expect(translucent.faceCount).toBe(0);
    expect(opaque.positions.length).toBe(6 * 4 * 3);
    expect(opaque.indices.length).toBe(6 * 6);
    expect(opaque.light.length).toBe(6 * 4 * 2);
  });

  it("two adjacent cubes cull their shared faces (10, not 12)", () => {
    const w = new WorldStore();
    w.setGenerated(8, 8, 8, STONE);
    w.setGenerated(9, 8, 8, STONE);
    expect(meshAt(w).opaque.faceCount).toBe(10);
  });

  it("a fully buried block contributes no faces", () => {
    const w = new WorldStore();
    for (let x = 7; x <= 9; x++)
      for (let y = 7; y <= 9; y++)
        for (let z = 7; z <= 9; z++) w.setGenerated(x, y, z, STONE);
    // 3x3x3 solid cube = only the outer shell renders: 9 faces per side * 6
    expect(meshAt(w).opaque.faceCount).toBe(9 * 6);
  });

  it("stone next to glass still renders its face (glass doesn't cull)", () => {
    const w = new WorldStore();
    w.setGenerated(8, 8, 8, STONE);
    w.setGenerated(9, 8, 8, GLASS);
    const { opaque, translucent } = meshAt(w);
    expect(opaque.faceCount).toBe(6); // stone keeps all 6
    expect(translucent.faceCount).toBe(5); // glass culls only against stone
  });

  it("water-water neighbors produce no internal faces", () => {
    const w = new WorldStore();
    w.setGenerated(8, 8, 8, WATER);
    w.setGenerated(9, 8, 8, WATER);
    expect(meshAt(w).translucent.faceCount).toBe(10);
  });

  it("leaves-leaves neighbors cull internal faces but stay visible", () => {
    const w = new WorldStore();
    w.setGenerated(8, 8, 8, LEAVES);
    w.setGenerated(9, 8, 8, LEAVES);
    expect(meshAt(w).opaque.faceCount).toBe(10);
  });

  it("a torch always renders its 6-face mini-cuboid", () => {
    const w = new WorldStore();
    w.setGenerated(8, 8, 8, TORCH);
    const { opaque } = meshAt(w);
    expect(opaque.faceCount).toBe(6);
    // mini-cuboid: no vertex on the full cube envelope
    for (let i = 0; i < opaque.positions.length; i += 3) {
      expect(opaque.positions[i]).toBeGreaterThan(8.3 - 1e-6);
      expect(opaque.positions[i]).toBeLessThan(8.7 + 1e-6);
    }
  });

  it("chunk-border faces use the neighbor chunk's blocks for culling", () => {
    const w = new WorldStore();
    w.setGenerated(15, 8, 8, STONE); // in chunk (0,0,0)
    w.setGenerated(16, 8, 8, STONE); // in chunk (1,0,0)
    const light = new LightGrid();
    light.recomputeAll(w);
    const m0 = buildChunkMesh(w, light, 0, 0, 0);
    expect(m0.opaque.faceCount).toBe(5); // +x face culled by neighbor chunk block
  });

  it("baked light attributes are in [0, 1]", () => {
    const w = new WorldStore();
    w.setGenerated(8, 8, 8, STONE);
    w.setGenerated(8, 10, 8, GLASS);
    const { opaque } = meshAt(w);
    for (const v of opaque.light) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
