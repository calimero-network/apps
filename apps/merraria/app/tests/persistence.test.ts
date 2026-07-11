import { beforeEach, describe, expect, it } from "vitest";
import { loadWorld, saveWorld } from "../src/state/persistence";

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
});
