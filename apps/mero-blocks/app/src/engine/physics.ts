// Player physics: AABB vs voxel grid, axis-separated sweep at a fixed tick.

import { isSolid, WATER } from "./blocks";
import { WorldStore, WORLD_SY } from "./world";

export const PLAYER_HALF = 0.3; // half width (x/z)
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

export const GRAVITY = 24; // blocks/s^2
export const JUMP_SPEED = 8.4;
export const MOVE_SPEED = 4.4;
export const SWIM_SPEED = 3.0;
export const WATER_DRAG = 0.6; // velocity multiplier per tick group
export const TICK = 1 / 60;

export interface PlayerState {
  x: number;
  y: number; // feet
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  inWater: boolean;
}

export interface MoveInput {
  /** desired horizontal velocity in world space (already yaw-rotated) */
  moveX: number;
  moveZ: number;
  jump: boolean;
}

function collidesAt(store: WorldStore, x: number, y: number, z: number): boolean {
  const x0 = Math.floor(x - PLAYER_HALF),
    x1 = Math.floor(x + PLAYER_HALF - 1e-7);
  const y0 = Math.floor(y),
    y1 = Math.floor(y + PLAYER_HEIGHT - 1e-7);
  const z0 = Math.floor(z - PLAYER_HALF),
    z1 = Math.floor(z + PLAYER_HALF - 1e-7);
  for (let by = y0; by <= y1; by++)
    for (let bz = z0; bz <= z1; bz++)
      for (let bx = x0; bx <= x1; bx++) {
        if (by < 0) return true; // world floor safety
        if (isSolid(store.getBlock(bx, by, bz))) return true;
      }
  return false;
}

export function bodyInWater(store: WorldStore, s: PlayerState): boolean {
  const cy = Math.floor(s.y + PLAYER_HEIGHT * 0.5);
  return store.getBlock(Math.floor(s.x), cy, Math.floor(s.z)) === WATER;
}

/** move along one axis, sub-stepped, stopping at the first collision */
function sweepAxis(
  store: WorldStore,
  s: PlayerState,
  axis: "x" | "y" | "z",
  delta: number,
): boolean {
  if (delta === 0) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.25));
  const inc = delta / steps;
  for (let i = 0; i < steps; i++) {
    const nx = axis === "x" ? s.x + inc : s.x;
    const ny = axis === "y" ? s.y + inc : s.y;
    const nz = axis === "z" ? s.z + inc : s.z;
    if (collidesAt(store, nx, ny, nz)) return true; // blocked
    s.x = nx;
    s.y = ny;
    s.z = nz;
  }
  return false;
}

/** one fixed 60Hz physics tick; mutates `s` in place */
export function stepPlayer(store: WorldStore, s: PlayerState, input: MoveInput, dt = TICK): void {
  s.inWater = bodyInWater(store, s);

  // horizontal: direct velocity control (arcadey, like classic MC creative-walk)
  const speed = s.inWater ? SWIM_SPEED : MOVE_SPEED;
  const mag = Math.hypot(input.moveX, input.moveZ);
  if (mag > 0) {
    s.vx = (input.moveX / mag) * speed;
    s.vz = (input.moveZ / mag) * speed;
  } else {
    s.vx = 0;
    s.vz = 0;
  }

  // vertical
  if (s.inWater) {
    s.vy -= GRAVITY * 0.35 * dt;
    if (input.jump) s.vy = SWIM_SPEED; // swim up
    s.vy *= Math.pow(WATER_DRAG, dt * 8);
  } else {
    if (input.jump && s.onGround) s.vy = JUMP_SPEED;
    s.vy -= GRAVITY * dt;
  }
  s.vy = Math.max(-40, s.vy);

  // axis-separated sweeps
  if (sweepAxis(store, s, "x", s.vx * dt)) s.vx = 0;
  if (sweepAxis(store, s, "z", s.vz * dt)) s.vz = 0;
  const blockedY = sweepAxis(store, s, "y", s.vy * dt);
  if (blockedY) {
    s.onGround = s.vy < 0;
    s.vy = 0;
  } else {
    s.onGround = false;
  }

  // never fall out of the world
  if (s.y < 0.5) {
    s.y = Math.max(s.y, 0.5);
    s.vy = Math.max(0, s.vy);
    s.onGround = true;
  }
  if (s.y > WORLD_SY + 10) s.y = WORLD_SY + 10;
}

/** does placing a block at (bx,by,bz) intersect the player AABB? */
export function blockIntersectsPlayer(
  s: PlayerState,
  bx: number,
  by: number,
  bz: number,
): boolean {
  return (
    bx + 1 > s.x - PLAYER_HALF &&
    bx < s.x + PLAYER_HALF &&
    by + 1 > s.y &&
    by < s.y + PLAYER_HEIGHT &&
    bz + 1 > s.z - PLAYER_HALF &&
    bz < s.z + PLAYER_HALF
  );
}
