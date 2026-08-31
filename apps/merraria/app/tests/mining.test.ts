import { describe, expect, it } from "vitest";
import { digTick, DigState, Inventory, place, withinReach } from "../src/engine/mining";
import { AIR, BEDROCK, DIRT, GRASS, PLANK, STONE, tileDef, TORCH } from "../src/engine/tiles";
import { TileStore } from "../src/engine/world";

const dig = (): DigState => ({ x: -1, y: -1, progress: 0 });

describe("inventory", () => {
  it("adds, counts, spends", () => {
    const inv = new Inventory({ [TORCH]: 2 });
    expect(inv.count(TORCH)).toBe(2);
    inv.add(DIRT, 3);
    expect(inv.count(DIRT)).toBe(3);
    expect(inv.spend(DIRT)).toBe(true);
    expect(inv.count(DIRT)).toBe(2);
    expect(inv.spend(STONE)).toBe(false);
  });

  it("round-trips through JSON", () => {
    const inv = new Inventory({ [TORCH]: 5 });
    inv.add(STONE, 7);
    const restored = new Inventory(inv.toJSON());
    expect(restored.count(TORCH)).toBe(5);
    expect(restored.count(STONE)).toBe(7);
  });
});

describe("digging", () => {
  it("takes hardness seconds to break a tile and drops it into the inventory", () => {
    const w = new TileStore();
    w.setGenerated(10, 10, STONE);
    const inv = new Inventory();
    const d = dig();
    const hardness = tileDef(STONE).hardness;
    // one tick short of breaking
    let mined = digTick(w, inv, d, 10, 10, hardness * 0.9);
    expect(mined).toBeNull();
    expect(w.getTile(10, 10)).toBe(STONE);
    mined = digTick(w, inv, d, 10, 10, hardness * 0.2);
    expect(mined).toBe(STONE);
    expect(w.getTile(10, 10)).toBe(AIR);
    expect(inv.count(STONE)).toBe(1);
  });

  it("grass drops dirt", () => {
    const w = new TileStore();
    w.setGenerated(10, 10, GRASS);
    const inv = new Inventory();
    digTick(w, inv, dig(), 10, 10, 10);
    expect(inv.count(DIRT)).toBe(1);
  });

  it("progress resets when the target moves", () => {
    const w = new TileStore();
    w.setGenerated(10, 10, STONE);
    w.setGenerated(11, 10, STONE);
    const inv = new Inventory();
    const d = dig();
    digTick(w, inv, d, 10, 10, 0.5);
    expect(d.progress).toBeGreaterThan(0);
    digTick(w, inv, d, 11, 10, 0.01);
    expect(d.progress).toBeLessThan(0.1); // restarted on the new tile
  });

  it("bedrock is unbreakable", () => {
    const w = new TileStore();
    w.setGenerated(10, 10, BEDROCK);
    const inv = new Inventory();
    expect(digTick(w, inv, dig(), 10, 10, 1000)).toBeNull();
    expect(w.getTile(10, 10)).toBe(BEDROCK);
  });
});

describe("placing", () => {
  it("consumes inventory and writes the tile", () => {
    const w = new TileStore();
    const inv = new Inventory({ [PLANK]: 1 });
    expect(place(w, inv, 5, 5, PLANK)).toBe(true);
    expect(w.getTile(5, 5)).toBe(PLANK);
    expect(inv.count(PLANK)).toBe(0);
    // out of stock now
    expect(place(w, inv, 6, 5, PLANK)).toBe(false);
    expect(w.getTile(6, 5)).toBe(AIR);
  });

  it("refuses to replace a solid tile", () => {
    const w = new TileStore();
    w.setGenerated(5, 5, STONE);
    const inv = new Inventory({ [PLANK]: 1 });
    expect(place(w, inv, 5, 5, PLANK)).toBe(false);
    expect(inv.count(PLANK)).toBe(1); // nothing spent
  });
});

describe("reach", () => {
  it("allows tiles within 5 tiles and rejects beyond", () => {
    expect(withinReach(10, 10, 13, 10)).toBe(true);
    expect(withinReach(10, 10, 16, 10)).toBe(false);
    expect(withinReach(10, 10, 13, 13)).toBe(true); // ~4.9
    expect(withinReach(10, 10, 14, 14)).toBe(false);
  });
});
