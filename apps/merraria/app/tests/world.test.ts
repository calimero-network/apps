import { describe, expect, it } from "vitest";
import { AIR, STONE } from "../src/engine/tiles";
import { parseTileKey, tileKey, TileStore } from "../src/engine/world";

describe("TileStore", () => {
  it("setTile overrides and reads back", () => {
    const w = new TileStore();
    expect(w.getTile(5, 5)).toBe(AIR);
    expect(w.setTile(5, 5, STONE)).toBe(true);
    expect(w.getTile(5, 5)).toBe(STONE);
    expect(w.overrides.get(tileKey(5, 5))).toBe(STONE);
  });

  it("same-value writes are no-ops", () => {
    const w = new TileStore();
    w.setTile(5, 5, STONE);
    w.lightDirty = false;
    expect(w.setTile(5, 5, STONE)).toBe(false);
    expect(w.lightDirty).toBe(false);
  });

  it("marks lighting dirty on change", () => {
    const w = new TileStore();
    w.lightDirty = false;
    w.setTile(5, 5, STONE);
    expect(w.lightDirty).toBe(true);
  });

  it("rejects out-of-bounds edits", () => {
    const w = new TileStore();
    expect(w.setTile(-1, 5, STONE)).toBe(false);
    expect(w.setTile(400, 5, STONE)).toBe(false);
    expect(w.setTile(5, 200, STONE)).toBe(false);
    expect(w.overrides.size).toBe(0);
  });

  it("overrides JSON round-trips diff-aware", () => {
    const a = new TileStore();
    a.setTile(1, 2, STONE);
    const json = a.overridesToJSON();
    const b = new TileStore();
    expect(b.applyOverridesJSON(json)).toBe(1);
    expect(b.getTile(1, 2)).toBe(STONE);
    expect(b.applyOverridesJSON(json)).toBe(0);
  });

  it("parseTileKey inverts tileKey", () => {
    expect(parseTileKey(tileKey(12, 34))).toEqual([12, 34]);
  });
});
