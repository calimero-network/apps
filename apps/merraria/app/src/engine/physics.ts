// 2D platformer physics: AABB vs tile grid, axis-separated sweep, fixed tick.
// y grows downward (canvas convention), so gravity is +y and jumping is -y.

import { isSolid, WATER } from "./tiles";
import { TileStore, WORLD_H, WORLD_W } from "./world";

export const PLAYER_HALF_W = 0.375; // half width in tiles
export const PLAYER_H = 1.9;

export const GRAVITY = 30; // tiles/s^2 (downward = +y)
export const JUMP_SPEED = 12.5;
export const MOVE_SPEED = 6;
export const SWIM_SPEED = 3.4;
export const TICK = 1 / 60;

export interface PlayerState {
  x: number;
  y: number; // feet (bottom of the AABB)
  vx: number;
  vy: number;
  onGround: boolean;
  inWater: boolean;
  facing: number; // -1 | 1
  /** mid-air jumps left — granted by leaping from the water surface */
  airJumps: number;
}

export interface MoveInput {
  /** -1 | 0 | 1 */
  move: number;
  /** held — ground jumps, swimming and surface leaps */
  jump: boolean;
  /** edge-triggered this tick — consumes a mid-air jump */
  jumpPressed?: boolean;
}

function collidesAt(store: TileStore, x: number, y: number): boolean {
  const x0 = Math.floor(x - PLAYER_HALF_W),
    x1 = Math.floor(x + PLAYER_HALF_W - 1e-7);
  const y0 = Math.floor(y - PLAYER_H),
    y1 = Math.floor(y - 1e-7);
  // the map edges are invisible walls, and below the last tile row is solid
  // ground — the player can never leave the world sideways or fall out the
  // bottom (even if the bedrock row gets mined away somehow)
  if (x0 < 0 || x1 >= WORLD_W || y1 >= WORLD_H) return true;
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(store.getTile(tx, ty))) return true;
    }
  return false;
}

const waterAt = (store: TileStore, x: number, y: number) =>
  store.getTile(Math.floor(x), Math.floor(y)) === WATER;

export function bodyInWater(store: TileStore, s: PlayerState): boolean {
  // feet OR center — sampling only the center made the surface count as "air",
  // so swimmers bobbed at the top unable to ever jump out.
  return waterAt(store, s.x, s.y - 0.1) || waterAt(store, s.x, s.y - PLAYER_H * 0.5);
}

/** in water but with the head above the surface — eligible to leap out */
export function atWaterSurface(store: TileStore, s: PlayerState): boolean {
  return bodyInWater(store, s) && !waterAt(store, s.x, s.y - PLAYER_H + 0.2);
}

function sweepAxis(store: TileStore, s: PlayerState, axis: "x" | "y", delta: number): boolean {
  if (delta === 0) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.2));
  const inc = delta / steps;
  for (let i = 0; i < steps; i++) {
    const nx = axis === "x" ? s.x + inc : s.x;
    const ny = axis === "y" ? s.y + inc : s.y;
    if (collidesAt(store, nx, ny)) return true;
    s.x = nx;
    s.y = ny;
  }
  return false;
}

/** one fixed 60Hz tick; mutates `s` in place */
export function stepPlayer(store: TileStore, s: PlayerState, input: MoveInput, dt = TICK): void {
  s.inWater = bodyInWater(store, s);

  const speed = s.inWater ? SWIM_SPEED : MOVE_SPEED;
  s.vx = input.move * speed;
  if (input.move !== 0) s.facing = input.move > 0 ? 1 : -1;

  if (s.inWater) {
    s.vy += GRAVITY * 0.3 * dt;
    if (input.jump) {
      if (atWaterSurface(store, s)) {
        // head above the surface: leap out at full jump strength, plus one
        // mid-air jump to clear the bank ("double jump from the water top")
        s.vy = -JUMP_SPEED;
        s.airJumps = 1;
      } else {
        s.vy = -SWIM_SPEED; // swim up
      }
    }
    s.vy *= Math.pow(0.6, dt * 8); // drag
  } else {
    if (input.jump && s.onGround) {
      s.vy = -JUMP_SPEED;
      s.airJumps = 0;
    } else if (input.jumpPressed && !s.onGround && s.airJumps > 0) {
      s.airJumps -= 1;
      s.vy = -JUMP_SPEED * 0.85;
    }
    s.vy += GRAVITY * dt;
  }
  s.vy = Math.min(40, s.vy);

  if (sweepAxis(store, s, "x", s.vx * dt)) s.vx = 0;
  const blockedY = sweepAxis(store, s, "y", s.vy * dt);
  if (blockedY) {
    s.onGround = s.vy > 0; // moving down (+y) into ground
    if (s.onGround) s.airJumps = 0;
    s.vy = 0;
  } else {
    s.onGround = false;
  }
}

/** does placing a tile at (tx,ty) intersect the player AABB? */
export function tileIntersectsPlayer(s: PlayerState, tx: number, ty: number): boolean {
  return (
    tx + 1 > s.x - PLAYER_HALF_W &&
    tx < s.x + PLAYER_HALF_W &&
    ty + 1 > s.y - PLAYER_H &&
    ty < s.y
  );
}
