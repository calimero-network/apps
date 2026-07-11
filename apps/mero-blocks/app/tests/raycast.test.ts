import { describe, expect, it } from "vitest";
import { STONE, WATER } from "../src/engine/blocks";
import { raycast } from "../src/engine/raycast";
import { WorldStore } from "../src/engine/world";

describe("raycast", () => {
  it("hits a floor straight down with the top face normal", () => {
    const w = new WorldStore();
    for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.setGenerated(x, 10, z, STONE);
    const hit = raycast(w, 16.5, 15, 16.5, 0, -1, 0, 10);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([16, 10, 16]);
    expect(hit!.face).toEqual([0, 1, 0]);
    expect(hit!.dist).toBeCloseTo(4, 1);
  });

  it("hits a side face when looking horizontally", () => {
    const w = new WorldStore();
    w.setGenerated(20, 10, 16, STONE);
    const hit = raycast(w, 16.5, 10.5, 16.5, 1, 0, 0, 10);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([20, 10, 16]);
    expect(hit!.face).toEqual([-1, 0, 0]);
  });

  it("returns null past max reach", () => {
    const w = new WorldStore();
    w.setGenerated(30, 10, 16, STONE);
    expect(raycast(w, 16.5, 10.5, 16.5, 1, 0, 0, 6)).toBeNull();
  });

  it("passes through water (water is not targetable)", () => {
    const w = new WorldStore();
    for (let x = 17; x <= 19; x++) w.setGenerated(x, 10, 16, WATER);
    w.setGenerated(20, 10, 16, STONE);
    const hit = raycast(w, 16.5, 10.5, 16.5, 1, 0, 0, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(20);
  });

  it("works along diagonals", () => {
    const w = new WorldStore();
    w.setGenerated(20, 10, 20, STONE);
    const hit = raycast(w, 16.5, 10.5, 16.5, 1, 0, 1, 12);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.z]).toEqual([20, 20]);
  });

  it("misses when nothing is in the path", () => {
    const w = new WorldStore();
    expect(raycast(w, 16.5, 30, 16.5, 0, 1, 0, 50)).toBeNull();
  });

  it("immediately reports a hit when starting inside a block", () => {
    const w = new WorldStore();
    w.setGenerated(16, 10, 16, STONE);
    const hit = raycast(w, 16.5, 10.5, 16.5, 1, 0, 0, 5);
    expect(hit).not.toBeNull();
    expect(hit!.dist).toBe(0);
  });
});
