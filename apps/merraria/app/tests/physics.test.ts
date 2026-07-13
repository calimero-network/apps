import { describe, expect, it } from "vitest";
import { PlayerState, stepPlayer, TICK, tileIntersectsPlayer } from "../src/engine/physics";
import { STONE, WATER } from "../src/engine/tiles";
import { TileStore } from "../src/engine/world";

const makeFloor = (y = 100): TileStore => {
  const w = new TileStore();
  for (let x = 0; x < 400; x++) w.setGenerated(x, y, STONE);
  return w;
};

const player = (x: number, y: number): PlayerState => ({
  x,
  y,
  vx: 0,
  vy: 0,
  onGround: false,
  inWater: false,
  facing: 1,
  airJumps: 0,
});

const idle = { move: 0, jump: false };
const run = (w: TileStore, p: PlayerState, input = idle, ticks = 120) => {
  for (let i = 0; i < ticks; i++) stepPlayer(w, p, input, TICK);
};

describe("2D physics (y grows downward)", () => {
  it("falls onto the floor and lands", () => {
    const w = makeFloor(100);
    const p = player(50.5, 95);
    run(w, p);
    expect(p.y).toBeCloseTo(100, 2); // feet on top of the floor tile
    expect(p.onGround).toBe(true);
  });

  it("jumps upward (negative y) and comes back down", () => {
    const w = makeFloor(100);
    const p = player(50.5, 100);
    run(w, p, idle, 30);
    stepPlayer(w, p, { move: 0, jump: true }, TICK);
    expect(p.vy).toBeLessThan(0);
    let apexY = p.y;
    for (let i = 0; i < 180; i++) {
      stepPlayer(w, p, idle, TICK);
      apexY = Math.min(apexY, p.y);
    }
    expect(100 - apexY).toBeGreaterThan(2); // cleared > 2 tiles
    expect(100 - apexY).toBeLessThan(4);
    expect(p.y).toBeCloseTo(100, 2);
  });

  it("no double jump in mid-air", () => {
    const w = makeFloor(100);
    const p = player(50.5, 90);
    stepPlayer(w, p, { move: 0, jump: true }, TICK);
    expect(p.vy).toBeGreaterThan(0); // still falling
  });

  it("is blocked by a wall and updates facing", () => {
    const w = makeFloor(100);
    for (let y = 96; y < 100; y++) w.setGenerated(55, y, STONE);
    const p = player(50.5, 100);
    run(w, p, { move: 1, jump: false }, 240);
    expect(p.facing).toBe(1);
    expect(p.x).toBeLessThanOrEqual(55 - 0.375 + 1e-6);
    expect(p.x).toBeGreaterThan(53);
  });

  it("head bump stops upward motion", () => {
    const w = makeFloor(100);
    for (let x = 0; x < 400; x++) w.setGenerated(x, 96, STONE); // low ceiling
    const p = player(50.5, 100);
    run(w, p, idle, 10);
    stepPlayer(w, p, { move: 0, jump: true }, TICK);
    run(w, p, idle, 30);
    // came back down: ceiling at 96 means head (y-1.9) never passes 97
    expect(p.y).toBeGreaterThanOrEqual(98.9 - 1e-6);
  });

  it("swims: slow sink, jump swims up", () => {
    const w = makeFloor(120);
    for (let x = 0; x < 400; x++)
      for (let y = 100; y < 120; y++) w.setGenerated(x, y, WATER);
    const sink = player(50.5, 110);
    run(w, sink, idle, 60);
    expect(sink.y - 110).toBeLessThan(6); // much slower than free fall

    const swimmer = player(50.5, 112);
    run(w, swimmer, { move: 0, jump: true }, 60);
    expect(swimmer.y).toBeLessThan(112); // moved up
  });

  it("leaps out of a shallow pool instead of getting stuck at the surface", () => {
    // pool: 2 tiles of water in a basin, solid banks either side
    const w = makeFloor(102);
    for (let x = 48; x <= 53; x++) {
      w.setGenerated(x, 100, WATER);
      w.setGenerated(x, 101, WATER);
    }
    for (let y = 100; y <= 101; y++) {
      w.setGenerated(47, y, STONE);
      w.setGenerated(54, y, STONE);
    }
    const p = player(50.5, 102); // standing on the pool floor
    run(w, p, { move: 0, jump: true }, 60);
    const apex = p.y;
    expect(102 - apex).toBeGreaterThan(2); // full jump strength, clears the bank
  });

  it("water-surface jump grants one mid-air (double) jump", () => {
    const w = makeFloor(120);
    for (let x = 0; x < 400; x++)
      for (let y = 100; y < 120; y++) w.setGenerated(x, y, WATER);
    const p = player(50.5, 100.5); // feet just under the surface
    // leap out from the surface
    stepPlayer(w, p, { move: 0, jump: true }, TICK);
    expect(p.vy).toBeLessThan(-8);
    expect(p.airJumps).toBe(1);
    // rise until the leap decays, then double-jump mid-air
    let minVy = p.vy;
    for (let i = 0; i < 40; i++) {
      stepPlayer(w, p, { move: 0, jump: false }, TICK);
      minVy = Math.min(minVy, p.vy);
    }
    const before = p.vy;
    stepPlayer(w, p, { move: 0, jump: false, jumpPressed: true }, TICK);
    expect(p.vy).toBeLessThan(before);
    expect(p.vy).toBeLessThan(0);
    expect(p.airJumps).toBe(0);
    // a second press does nothing — the charge is spent
    const spent = p.vy;
    stepPlayer(w, p, { move: 0, jump: false, jumpPressed: true }, TICK);
    expect(p.vy).toBeGreaterThan(spent); // only gravity acted
  });

  it("mid-air jump charge is cleared on landing", () => {
    const w = makeFloor(100);
    const p = player(50.5, 100);
    p.airJumps = 1;
    run(w, p, idle, 30); // settle on the ground
    expect(p.onGround).toBe(true);
    expect(p.airJumps).toBe(0);
    stepPlayer(w, p, { move: 0, jump: false, jumpPressed: true }, TICK);
    expect(p.vy).toBeGreaterThanOrEqual(0); // no phantom double jump from the ground
  });

  it("cannot walk or jump off the map edges", () => {
    const w = makeFloor(100);
    const left = player(2, 100);
    run(w, left, { move: -1, jump: true }, 300);
    expect(left.x).toBeGreaterThanOrEqual(0.375 - 1e-6); // half-width from the edge
    expect(left.y).toBeLessThanOrEqual(100 + 1e-6); // never fell below the floor

    const right = player(398, 100);
    run(w, right, { move: 1, jump: true }, 300);
    expect(right.x).toBeLessThanOrEqual(400 - 0.375 + 1e-6);
    expect(right.y).toBeLessThanOrEqual(100 + 1e-6);
  });

  it("tileIntersectsPlayer blocks placing into your own body", () => {
    const p = player(10.5, 100);
    expect(tileIntersectsPlayer(p, 10, 99)).toBe(true); // legs
    expect(tileIntersectsPlayer(p, 10, 98)).toBe(true); // torso/head
    expect(tileIntersectsPlayer(p, 12, 99)).toBe(false);
    expect(tileIntersectsPlayer(p, 10, 96)).toBe(false); // above head
  });
});
