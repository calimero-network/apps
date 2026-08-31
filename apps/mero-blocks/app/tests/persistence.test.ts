import { beforeEach, describe, expect, it } from "vitest";
import { loadWorld, listWorlds, saveWorld } from "../src/state/persistence";

const sample = {
  seed: 1337,
  name: "test world",
  overrides: { "1,2,3": 5, "4,5,6": 0 },
  player: { x: 1, y: 2, z: 3, yaw: 0.5, pitch: -0.2, sel: 2, name: "Fran" },
  savedAt: 1720000000000,
};

beforeEach(() => localStorage.clear());

describe("persistence", () => {
  it("round-trips a world save", () => {
    saveWorld("ctx-abc", sample);
    expect(loadWorld("ctx-abc")).toEqual(sample);
  });

  it("returns null for a missing world", () => {
    expect(loadWorld("nope")).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    localStorage.setItem("mero-blocks/bad", "{not json");
    expect(loadWorld("bad")).toBeNull();
  });

  it("returns null for a save missing required fields", () => {
    localStorage.setItem("mero-blocks/weird", JSON.stringify({ hello: 1 }));
    expect(loadWorld("weird")).toBeNull();
  });

  it("lists saved worlds newest first", () => {
    saveWorld("old", { ...sample, savedAt: 100 });
    saveWorld("new", { ...sample, savedAt: 200 });
    expect(listWorlds().map((w) => w.worldId)).toEqual(["new", "old"]);
  });
});
