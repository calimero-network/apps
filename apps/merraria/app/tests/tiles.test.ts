import { describe, expect, it } from "vitest";
import {
  AIR,
  BEDROCK,
  breakable,
  DIRT,
  emissive,
  GRASS,
  HOTBAR,
  isOpaque,
  isSolid,
  ORE_COAL,
  ORE_GOLD,
  ORE_IRON,
  STARTING_INVENTORY,
  STONE,
  tileDef,
  TILES,
  TORCH,
  WATER,
} from "../src/engine/tiles";

describe("tile registry invariants", () => {
  it("air and water are walk-through and unbreakable/unmineable", () => {
    expect(isSolid(AIR)).toBe(false);
    expect(isSolid(WATER)).toBe(false);
    expect(breakable(AIR)).toBe(false);
    expect(breakable(WATER)).toBe(false);
  });

  it("bedrock is unbreakable; every hotbar tile is breakable", () => {
    expect(breakable(BEDROCK)).toBe(false);
    for (const id of HOTBAR) expect(breakable(id)).toBe(true);
  });

  it("ores get harder with rarity", () => {
    expect(tileDef(ORE_COAL).hardness).toBeLessThan(tileDef(ORE_IRON).hardness);
    expect(tileDef(ORE_IRON).hardness).toBeLessThan(tileDef(ORE_GOLD).hardness);
    expect(tileDef(STONE).hardness).toBeLessThan(tileDef(ORE_COAL).hardness);
  });

  it("torch is the only light source and doesn't block movement", () => {
    const emitters = TILES.filter((t) => t && t.emissive > 0).map((t) => t.id);
    expect(emitters).toEqual([TORCH]);
    expect(emissive(TORCH)).toBe(14);
    expect(isSolid(TORCH)).toBe(false);
    expect(isOpaque(TORCH)).toBe(false);
  });

  it("grass drops dirt; everything else drops itself", () => {
    expect(tileDef(GRASS).drops).toBe(DIRT);
    for (const id of HOTBAR) expect(tileDef(id).drops).toBe(id);
  });

  it("starting inventory covers torches and planks only", () => {
    const ids = Object.keys(STARTING_INVENTORY).map(Number);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(HOTBAR).toContain(id);
  });

  it("unknown ids fall back to air", () => {
    expect(tileDef(200).name).toBe("air");
  });

  it("every defined tile id matches its registry index", () => {
    TILES.forEach((def, i) => {
      if (def) expect(def.id).toBe(i);
    });
  });
});
