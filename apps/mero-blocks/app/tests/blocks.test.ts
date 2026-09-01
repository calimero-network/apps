import { describe, expect, it } from "vitest";
import {
  AIR,
  BEDROCK,
  BLOCKS,
  blockDef,
  emissive,
  GLOWSTONE,
  HOTBAR,
  isOpaque,
  isSolid,
  TORCH,
  WATER,
} from "../src/engine/blocks";

describe("block registry invariants", () => {
  it("air is neither solid nor opaque and can't be broken", () => {
    expect(isSolid(AIR)).toBe(false);
    expect(isOpaque(AIR)).toBe(false);
    expect(blockDef(AIR).breakable).toBe(false);
  });

  it("bedrock is unbreakable, everything else on the hotbar is breakable", () => {
    expect(blockDef(BEDROCK).breakable).toBe(false);
    for (const id of HOTBAR) expect(blockDef(id).breakable).toBe(true);
  });

  it("water is walk-through and see-through", () => {
    expect(isSolid(WATER)).toBe(false);
    expect(isOpaque(WATER)).toBe(false);
  });

  it("torch and glowstone are the only light sources", () => {
    const emitters = BLOCKS.filter((b) => b && b.emissive > 0).map((b) => b.id);
    expect(emitters.sort()).toEqual([TORCH, GLOWSTONE].sort());
    expect(emissive(GLOWSTONE)).toBe(15);
    expect(emissive(TORCH)).toBe(14);
  });

  it("every hotbar slot maps to a defined block with colors", () => {
    expect(HOTBAR).toHaveLength(9);
    for (const id of HOTBAR) {
      const def = blockDef(id);
      expect(def.name).not.toBe("air");
      expect(def.colors).toHaveLength(3);
      for (const face of def.colors)
        for (const c of face) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
    }
  });

  it("unknown ids fall back to air instead of crashing", () => {
    expect(blockDef(200).name).toBe("air");
    expect(isSolid(255)).toBe(false);
  });

  it("every defined block has a stable id matching its index", () => {
    BLOCKS.forEach((def, i) => {
      if (def) expect(def.id).toBe(i);
    });
  });
});
