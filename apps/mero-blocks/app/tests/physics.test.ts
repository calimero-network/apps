import { describe, expect, it } from "vitest";
import { STONE, WATER } from "../src/engine/blocks";
import {
  blockIntersectsPlayer,
  JUMP_SPEED,
  PlayerState,
  stepPlayer,
  TICK,
} from "../src/engine/physics";
import { WorldStore } from "../src/engine/world";

const makeFloor = (y = 10): WorldStore => {
  const w = new WorldStore();
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) w.setGenerated(x, y, z, STONE);
  return w;
};

const player = (x: number, y: number, z: number): PlayerState => ({
  x,
  y,
  z,
  vx: 0,
  vy: 0,
  vz: 0,
  onGround: false,
  inWater: false,
});

const idle = { moveX: 0, moveZ: 0, jump: false };

const run = (w: WorldStore, p: PlayerState, input = idle, ticks = 60) => {
  for (let i = 0; i < ticks; i++) stepPlayer(w, p, input, TICK);
};

describe("physics", () => {
  it("falls and lands on the floor", () => {
    const w = makeFloor(10);
    const p = player(32.5, 15, 32.5);
    run(w, p, idle, 120);
    expect(p.y).toBeCloseTo(11, 2); // feet rest on top of the floor block
    expect(p.onGround).toBe(true);
    expect(p.vy).toBe(0);
  });

  it("jumps and returns to the ground", () => {
    const w = makeFloor(10);
    const p = player(32.5, 11, 32.5);
    run(w, p, idle, 30); // settle
    let apex = p.y;
    const jumpInput = { moveX: 0, moveZ: 0, jump: true };
    stepPlayer(w, p, jumpInput, TICK);
    expect(p.vy).toBeCloseTo(JUMP_SPEED - 24 * TICK, 3);
    for (let i = 0; i < 120; i++) {
      stepPlayer(w, p, idle, TICK);
      apex = Math.max(apex, p.y);
    }
    expect(apex).toBeGreaterThan(12); // cleared more than a block
    expect(apex).toBeLessThan(13); // but not two
    expect(p.y).toBeCloseTo(11, 2);
    expect(p.onGround).toBe(true);
  });

  it("cannot jump in mid-air", () => {
    const w = makeFloor(10);
    const p = player(32.5, 14, 32.5);
    stepPlayer(w, p, { moveX: 0, moveZ: 0, jump: true }, TICK);
    expect(p.vy).toBeLessThan(0); // no double jump — just falling
  });

  it("walks and is stopped by a wall", () => {
    const w = makeFloor(10);
    for (let y = 11; y <= 13; y++) for (let z = 0; z < 64; z++) w.setGenerated(36, y, z, STONE);
    const p = player(32.5, 11, 32.5);
    run(w, p, { moveX: 1, moveZ: 0, jump: false }, 240);
    // wall at x=36 — player half-width 0.3 keeps us at ~35.7
    expect(p.x).toBeLessThanOrEqual(36 - 0.3 + 1e-6);
    expect(p.x).toBeGreaterThan(35);
  });

  it("slides along a wall (blocked axis zeroes, other axis moves)", () => {
    const w = makeFloor(10);
    for (let y = 11; y <= 13; y++) for (let z = 0; z < 64; z++) w.setGenerated(36, y, z, STONE);
    const p = player(35.6, 11, 32.5);
    run(w, p, { moveX: 1, moveZ: 1, jump: false }, 60);
    expect(p.x).toBeLessThanOrEqual(36 - 0.3 + 1e-6);
    expect(p.z).toBeGreaterThan(33); // still made progress along z
  });

  it("swims: sinks slowly in water and can swim up", () => {
    const w = makeFloor(10);
    for (let x = 0; x < 64; x++)
      for (let z = 0; z < 64; z++)
        for (let y = 11; y <= 20; y++) w.setGenerated(x, y, z, WATER);
    const p = player(32.5, 16, 32.5);
    stepPlayer(w, p, idle, TICK);
    expect(p.inWater).toBe(true);

    // sinking is slow: after 1s in water we've fallen far less than free fall
    const sink = player(32.5, 16, 32.5);
    run(w, sink, idle, 60);
    expect(16 - sink.y).toBeLessThan(4);

    // swimming up gains altitude
    const swimmer = player(32.5, 13, 32.5);
    run(w, swimmer, { moveX: 0, moveZ: 0, jump: true }, 60);
    expect(swimmer.y).toBeGreaterThan(13);
  });

  it("never falls out of the world", () => {
    const w = new WorldStore(); // no floor at all
    const p = player(32.5, 5, 32.5);
    run(w, p, idle, 600);
    expect(p.y).toBeGreaterThanOrEqual(0.5);
  });

  it("blockIntersectsPlayer prevents placing a block inside yourself", () => {
    const p = player(10.5, 20, 10.5);
    expect(blockIntersectsPlayer(p, 10, 20, 10)).toBe(true);
    expect(blockIntersectsPlayer(p, 10, 21, 10)).toBe(true); // head
    expect(blockIntersectsPlayer(p, 12, 20, 10)).toBe(false);
    expect(blockIntersectsPlayer(p, 10, 22, 10)).toBe(false); // above head
  });
});
