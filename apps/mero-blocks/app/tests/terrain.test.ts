import { describe, expect, it } from "vitest";
import { AIR, BEDROCK, WATER } from "../src/engine/blocks";
import {
  fractalNoise2,
  generateWorld,
  hash2,
  mulberry32,
  spawnPoint,
  surfaceHeight,
} from "../src/engine/terrain";
import { SEA_LEVEL, WORLD_SX, WORLD_SY, WORLD_SZ, WorldStore } from "../src/engine/world";

describe("PRNG / noise determinism", () => {
  it("mulberry32 produces the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("hash2 is deterministic and in [0, 1)", () => {
    for (let i = 0; i < 200; i++) {
      const v = hash2(7, i * 13, i * 31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash2(7, i * 13, i * 31)).toBe(v);
    }
  });

  it("different seeds give different noise fields", () => {
    let differing = 0;
    for (let i = 0; i < 50; i++) {
      if (fractalNoise2(1, i, i) !== fractalNoise2(2, i, i)) differing++;
    }
    expect(differing).toBeGreaterThan(40);
  });
});

describe("world generation", () => {
  it("same seed generates byte-identical worlds (the networking invariant)", () => {
    const a = new WorldStore();
    const b = new WorldStore();
    generateWorld(a, 1337);
    generateWorld(b, 1337);
    for (const [key, chunk] of a.chunks) {
      const other = b.chunks.get(key);
      expect(other, `chunk ${key} missing`).toBeDefined();
      let equal = chunk.length === other!.length;
      for (let i = 0; equal && i < chunk.length; i++) equal = chunk[i] === other![i];
      expect(equal, `chunk ${key} differs`).toBe(true);
    }
    expect(a.chunks.size).toBe(b.chunks.size);
  });

  it("different seeds generate different worlds", () => {
    const a = new WorldStore();
    const b = new WorldStore();
    generateWorld(a, 1);
    generateWorld(b, 2);
    let diffs = 0;
    for (let x = 0; x < WORLD_SX; x += 7)
      for (let z = 0; z < WORLD_SZ; z += 7)
        for (let y = 0; y < WORLD_SY; y += 5) {
          if (a.getBlock(x, y, z) !== b.getBlock(x, y, z)) diffs++;
        }
    expect(diffs).toBeGreaterThan(50);
  });

  it("generation records no overrides (world = f(seed) exactly)", () => {
    const store = new WorldStore();
    generateWorld(store, 99);
    expect(store.overrides.size).toBe(0);
  });

  it("has bedrock floor everywhere", () => {
    const store = new WorldStore();
    generateWorld(store, 5);
    for (let x = 0; x < WORLD_SX; x += 11)
      for (let z = 0; z < WORLD_SZ; z += 11) expect(store.getBlock(x, 0, z)).toBe(BEDROCK);
  });

  it("fills water up to sea level in low columns", () => {
    const store = new WorldStore();
    generateWorld(store, 1337);
    let waterSeen = 0;
    for (let x = 0; x < WORLD_SX; x += 3)
      for (let z = 0; z < WORLD_SZ; z += 3) {
        const h = surfaceHeight(1337, x, z);
        if (h < SEA_LEVEL) {
          expect(store.getBlock(x, SEA_LEVEL, z)).toBe(WATER);
          waterSeen++;
        }
      }
    expect(waterSeen).toBeGreaterThan(0);
  });

  it("surface heights stay inside world bounds", () => {
    for (let x = 0; x < WORLD_SX; x += 5)
      for (let z = 0; z < WORLD_SZ; z += 5) {
        const h = surfaceHeight(1337, x, z);
        expect(h).toBeGreaterThanOrEqual(2);
        expect(h).toBeLessThan(WORLD_SY - 5);
      }
  });

  it("spawn point is dry and in the air", () => {
    const store = new WorldStore();
    generateWorld(store, 1337);
    const s = spawnPoint(1337);
    expect(store.getBlock(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))).toBe(AIR);
    const h = surfaceHeight(1337, Math.floor(s.x), Math.floor(s.z));
    expect(h).toBeGreaterThan(SEA_LEVEL);
  });
});
