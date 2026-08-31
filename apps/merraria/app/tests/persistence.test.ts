import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteWorld,
  hasWorld,
  loadWorld,
  playerInBounds,
  saveWorld,
} from "../src/state/persistence";
import { PLAYER_HALF_W } from "../src/engine/physics";
import { WORLD_H, WORLD_W } from "../src/engine/world";

const sample = {
  seed: 42,
  name: "test",
  overrides: { "1,2": 5 },
  inventory: { 8: 30, 7: 40 },
  player: { x: 10, y: 60, sel: 1, name: "Fran" },
  savedAt: 1720000000000,
};

beforeEach(() => localStorage.clear());

describe("persistence", () => {
  it("round-trips including inventory", () => {
    saveWorld("ctx-1", sample);
    expect(loadWorld("ctx-1")).toEqual(sample);
  });

  it("returns null for missing/corrupt saves", () => {
    expect(loadWorld("nope")).toBeNull();
    localStorage.setItem("merraria/bad", "{oops");
    expect(loadWorld("bad")).toBeNull();
    localStorage.setItem("merraria/weird", JSON.stringify({ nope: 1 }));
    expect(loadWorld("weird")).toBeNull();
  });

  it("deleteWorld removes the save; hasWorld reflects it", () => {
    saveWorld("local", sample);
    expect(hasWorld("local")).toBe(true);
    deleteWorld("local");
    expect(hasWorld("local")).toBe(false);
    expect(loadWorld("local")).toBeNull();
    deleteWorld("local"); // idempotent
  });
});

describe("playerInBounds (rescue for pre-edge-wall saves)", () => {
  const at = (x: number, y: number) => ({ x, y, sel: 0, name: "Fran" });

  it("accepts a position inside the world", () => {
    expect(playerInBounds(at(200, 100))).toBe(true);
    expect(playerInBounds(at(PLAYER_HALF_W, 100))).toBe(true); // flush against the wall
    expect(playerInBounds(at(WORLD_W - PLAYER_HALF_W, WORLD_H))).toBe(true); // bottom corner
  });

  it("rejects a player who fell off the map (the falling-forever save)", () => {
    expect(playerInBounds(at(-3, 100))).toBe(false); // off the left edge
    expect(playerInBounds(at(WORLD_W + 5, 100))).toBe(false); // off the right edge
    expect(playerInBounds(at(200, WORLD_H + 50))).toBe(false); // below the world
    expect(playerInBounds(at(200, 0))).toBe(false); // head above the sky
  });

  it("rejects missing or corrupt positions", () => {
    expect(playerInBounds(null)).toBe(false);
    expect(playerInBounds(undefined)).toBe(false);
    expect(playerInBounds(at(NaN, 100))).toBe(false);
    expect(playerInBounds(at(200, Infinity))).toBe(false);
  });
});
