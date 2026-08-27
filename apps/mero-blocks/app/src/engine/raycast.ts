// Voxel raycast (Amanatides & Woo DDA) for block targeting.

import { AIR, WATER } from "./blocks";
import { WorldStore } from "./world";

export interface RayHit {
  /** hit block coords */
  x: number;
  y: number;
  z: number;
  /** face normal the ray entered through — place target = hit + face */
  face: [number, number, number];
  dist: number;
}

/** blocks the crosshair can target (water is see-through for targeting) */
const targetable = (id: number) => id !== AIR && id !== WATER;

export function raycast(
  store: WorldStore,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): RayHit | null {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  dx /= len;
  dy /= len;
  dz /= len;

  let x = Math.floor(ox),
    y = Math.floor(oy),
    z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1,
    stepY = dy > 0 ? 1 : -1,
    stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  const frac = (v: number) => v - Math.floor(v);
  let tMaxX = dx !== 0 ? (dx > 0 ? (1 - frac(ox)) * tDeltaX : frac(ox) * tDeltaX) : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? (1 - frac(oy)) * tDeltaY : frac(oy) * tDeltaY) : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? (1 - frac(oz)) * tDeltaZ : frac(oz) * tDeltaZ) : Infinity;

  let face: [number, number, number] = [0, 0, 0];
  let t = 0;

  // starting inside a targetable block counts as an immediate hit
  if (targetable(store.getBlock(x, y, z))) return { x, y, z, face: [0, 0, 0], dist: 0 };

  while (t <= maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      face = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      face = [0, 0, -stepZ];
    }
    if (t > maxDist) return null;
    if (targetable(store.getBlock(x, y, z))) return { x, y, z, face, dist: t };
  }
  return null;
}
