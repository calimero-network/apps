import { describe, expect, it } from "vitest";
import { AIR, STONE, TORCH } from "../src/engine/blocks";
import { blockKey, chunkKey, parseBlockKey, WorldStore } from "../src/engine/world";

describe("WorldStore", () => {
  it("setBlock overrides and getBlock reads back", () => {
    const w = new WorldStore();
    expect(w.getBlock(5, 5, 5)).toBe(AIR);
    expect(w.setBlock(5, 5, 5, STONE)).toBe(true);
    expect(w.getBlock(5, 5, 5)).toBe(STONE);
    expect(w.overrides.get(blockKey(5, 5, 5))).toBe(STONE);
  });

  it("setting the same value is a no-op (no dirty, no relight)", () => {
    const w = new WorldStore();
    w.setBlock(5, 5, 5, STONE);
    w.takeDirty();
    w.pendingRelights.length = 0;
    expect(w.setBlock(5, 5, 5, STONE)).toBe(false);
    expect(w.dirty.size).toBe(0);
    expect(w.pendingRelights.length).toBe(0);
  });

  it("rejects out-of-bounds edits", () => {
    const w = new WorldStore();
    expect(w.setBlock(-1, 5, 5, STONE)).toBe(false);
    expect(w.setBlock(5, 64, 5, STONE)).toBe(false);
    expect(w.setBlock(128, 5, 5, STONE)).toBe(false);
    expect(w.overrides.size).toBe(0);
  });

  it("marks only the containing chunk dirty for an interior edit", () => {
    const w = new WorldStore();
    w.setBlock(8, 8, 8, STONE);
    expect([...w.dirty]).toEqual([chunkKey(0, 0, 0)]);
  });

  it("marks neighbor chunks dirty for border edits", () => {
    const w = new WorldStore();
    w.setBlock(15, 8, 8, STONE); // +x face of chunk (0,0,0)
    expect(w.dirty.has(chunkKey(0, 0, 0))).toBe(true);
    expect(w.dirty.has(chunkKey(1, 0, 0))).toBe(true);
    expect(w.dirty.size).toBe(2);
  });

  it("marks three chunks for an edge edit", () => {
    const w = new WorldStore();
    w.setBlock(16, 16, 8, STONE); // -x and -y borders of chunk (1,1,0)
    expect(w.dirty.has(chunkKey(1, 1, 0))).toBe(true);
    expect(w.dirty.has(chunkKey(0, 1, 0))).toBe(true);
    expect(w.dirty.has(chunkKey(1, 0, 0))).toBe(true);
  });

  it("queues a relight per edit", () => {
    const w = new WorldStore();
    w.setBlock(3, 3, 3, TORCH);
    w.setBlock(4, 3, 3, STONE);
    expect(w.pendingRelights).toEqual([
      [3, 3],
      [4, 3],
    ]);
  });

  it("overrides JSON round-trips and applies as a diff", () => {
    const a = new WorldStore();
    a.setBlock(1, 2, 3, STONE);
    // breaking an already-air cell is a local no-op (nothing to record)
    expect(a.setBlock(4, 5, 6, AIR)).toBe(false);
    const json = a.overridesToJSON();
    expect(Object.keys(json)).toEqual(["1,2,3"]);

    const b = new WorldStore();
    b.setBlock(9, 9, 9, STONE); // pre-existing local edit stays
    const applied = b.applyOverridesJSON(json);
    expect(applied).toBe(1);
    expect(b.getBlock(1, 2, 3)).toBe(STONE);
    expect(b.getBlock(9, 9, 9)).toBe(STONE);

    // re-applying the same overrides is a no-op (diff-aware)
    expect(b.applyOverridesJSON(json)).toBe(0);
  });

  it("parseBlockKey inverts blockKey", () => {
    expect(parseBlockKey(blockKey(12, 34, 56))).toEqual([12, 34, 56]);
  });
});
