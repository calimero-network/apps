import { describe, expect, it } from "vitest";
import { AIR, BEDROCK, GRASS, ORE_COAL, ORE_GOLD, ORE_IRON, SAND, WATER } from "../src/engine/tiles";
import { generateWorld, hash2, mulberry32, spawnPoint, surfaceY, valueNoise1 } from "../src/engine/terrain";
import { TileStore, WORLD_H, WORLD_W } from "../src/engine/world";

describe("noise determinism", () => {
  it("mulberry32 and hash2 are deterministic", () => {
    const a = mulberry32(42),
      b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    for (let i = 0; i < 100; i++) {
      const v = hash2(7, i, i * 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash2(7, i, i * 3)).toBe(v);
    }
  });

  it("valueNoise1 is continuous (no cliffs between neighbors)", () => {
    for (let x = 0; x < 200; x++) {
      expect(Math.abs(valueNoise1(5, x + 1, 40) - valueNoise1(5, x, 40))).toBeLessThan(0.2);
    }
  });
});

describe("world generation", () => {
  it("same seed => byte-identical world (the networking invariant)", () => {
    const a = new TileStore(),
      b = new TileStore();
    generateWorld(a, 42);
    generateWorld(b, 42);
    let equal = true;
    for (let i = 0; equal && i < a.tiles.length; i++) equal = a.tiles[i] === b.tiles[i];
    expect(equal).toBe(true);
  });

  it("different seeds differ", () => {
    const a = new TileStore(),
      b = new TileStore();
    generateWorld(a, 1);
    generateWorld(b, 2);
    let diffs = 0;
    for (let i = 0; i < a.tiles.length; i += 97) if (a.tiles[i] !== b.tiles[i]) diffs++;
    expect(diffs).toBeGreaterThan(20);
  });

  it("generation records no overrides", () => {
    const s = new TileStore();
    generateWorld(s, 9);
    expect(s.overrides.size).toBe(0);
  });

  it("has a bedrock floor and open sky", () => {
    const s = new TileStore();
    generateWorld(s, 42);
    for (let x = 0; x < WORLD_W; x += 13) {
      expect(s.getTile(x, WORLD_H - 1)).toBe(BEDROCK);
      expect(s.getTile(x, 0)).toBe(AIR);
    }
  });

  it("surface is grass (or sand at lakes) at surfaceY", () => {
    const s = new TileStore();
    generateWorld(s, 42);
    let grassy = 0;
    for (let x = 6; x < WORLD_W - 6; x += 5) {
      const y = surfaceY(42, x);
      const t = s.getTile(x, y);
      // trees/carving may perturb a few columns; most must be grass/sand
      if (t === GRASS || t === SAND) grassy++;
    }
    expect(grassy).toBeGreaterThan(60);
  });

  it("generates caves (air pockets under the surface)", () => {
    const s = new TileStore();
    generateWorld(s, 42);
    let caveCells = 0;
    for (let x = 0; x < WORLD_W; x += 2)
      for (let y = surfaceY(42, x) + 8; y < WORLD_H - 2; y += 2) {
        if (s.getTile(x, y) === AIR) caveCells++;
      }
    expect(caveCells).toBeGreaterThan(100);
  });

  it("sprinkles ores with depth stratification", () => {
    const s = new TileStore();
    generateWorld(s, 42);
    const count = (id: number) => {
      let n = 0;
      for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === id) n++;
      return n;
    };
    expect(count(ORE_COAL)).toBeGreaterThan(50);
    expect(count(ORE_IRON)).toBeGreaterThan(10);
    expect(count(ORE_GOLD)).toBeGreaterThan(3);
    expect(count(ORE_COAL)).toBeGreaterThan(count(ORE_GOLD));
  });

  it("fills lakes with water below the lake level", () => {
    const s = new TileStore();
    generateWorld(s, 42);
    let water = 0;
    for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === WATER) water++;
    expect(water).toBeGreaterThan(0);
  });

  it("spawn point is above solid ground and out of water", () => {
    const s = new TileStore();
    generateWorld(s, 42);
    const p = spawnPoint(42);
    expect(s.getTile(Math.floor(p.x), Math.floor(p.y))).toBe(AIR);
    const ground = surfaceY(42, Math.floor(p.x));
    expect(s.getTile(Math.floor(p.x), ground)).not.toBe(WATER);
  });
});
