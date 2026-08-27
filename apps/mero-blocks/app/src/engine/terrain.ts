// Deterministic terrain generation. Same seed => byte-identical world on every
// client; the network only ever carries the diff (see world.ts overrides).

import {
  AIR,
  BEDROCK,
  DIRT,
  GLOWSTONE,
  GRASS,
  LEAVES,
  SAND,
  SNOW,
  STONE,
  WATER,
  WOOD,
} from "./blocks";
import { SEA_LEVEL, WORLD_SX, WORLD_SY, WORLD_SZ, WorldStore } from "./world";

/** mulberry32 PRNG — tiny, fast, deterministic across JS engines */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** deterministic hash of (seed, x, z) -> [0, 1) */
export function hash2(seed: number, x: number, z: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x * 374761393), 668265263) >>> 0;
  h = Math.imul(h ^ (z * 2246822519), 3266489917) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2654435761) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 2D value noise, one octave, lattice cell size = scale */
export function valueNoise2(seed: number, x: number, z: number, scale: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = smooth(fx - x0);
  const tz = smooth(fz - z0);
  const a = hash2(seed, x0, z0);
  const b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1);
  const d = hash2(seed, x0 + 1, z0 + 1);
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * tz;
}

/** fractal noise (3 octaves) in [0, 1) */
export function fractalNoise2(seed: number, x: number, z: number): number {
  return (
    valueNoise2(seed, x, z, 48) * 0.55 +
    valueNoise2(seed ^ 0x9e3779b9, x, z, 20) * 0.3 +
    valueNoise2(seed ^ 0x51ab7cd3, x, z, 8) * 0.15
  );
}

/** terrain surface height at column (x, z) — top solid block y */
export function surfaceHeight(seed: number, x: number, z: number): number {
  const n = fractalNoise2(seed, x, z);
  const h = Math.floor(12 + n * 30); // 12..42
  return Math.min(WORLD_SY - 10, Math.max(2, h));
}

const TREE_CHANCE = 0.012;
const GLOW_CHANCE = 0.002;

function plantTree(store: WorldStore, rand: () => number, x: number, y: number, z: number): void {
  const height = 4 + Math.floor(rand() * 2); // 4-5 trunk
  for (let i = 0; i < height; i++) store.setGenerated(x, y + i, z, WOOD);
  const top = y + height;
  for (let dy = -2; dy <= 1; dy++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const r = Math.abs(dx) + Math.abs(dz) + Math.max(0, dy);
        if (r > 3 || (dx === 0 && dz === 0 && dy < 0)) continue;
        const bx = x + dx,
          by = top + dy,
          bz = z + dz;
        if (store.getBlock(bx, by, bz) === AIR) store.setGenerated(bx, by, bz, LEAVES);
      }
}

/**
 * Fill the store with generated terrain. Deterministic: iteration order is
 * fixed and all randomness is column-hash or PRNG seeded from `seed`.
 */
export function generateWorld(store: WorldStore, seed: number): void {
  // pass 1: columns
  for (let x = 0; x < WORLD_SX; x++) {
    for (let z = 0; z < WORLD_SZ; z++) {
      const h = surfaceHeight(seed, x, z);
      store.setGenerated(x, 0, z, BEDROCK);
      for (let y = 1; y <= h; y++) {
        let b: number;
        if (y < h - 3) {
          b = STONE;
          if (y < 14 && hash2(seed ^ 0x6c1e5a2f, x * 64 + y, z * 64 + y) < GLOW_CHANCE)
            b = GLOWSTONE;
        } else if (y < h) {
          b = DIRT;
        } else {
          // surface block
          if (h <= SEA_LEVEL + 1) b = SAND;
          else if (h >= 38) b = SNOW;
          else b = GRASS;
        }
        store.setGenerated(x, y, z, b);
      }
      // water fill
      for (let y = h + 1; y <= SEA_LEVEL; y++) store.setGenerated(x, y, z, WATER);
    }
  }
  // pass 2: trees (deterministic column hash; skip world edges)
  const rand = mulberry32(seed ^ 0x7f4a7c15);
  for (let x = 3; x < WORLD_SX - 3; x++) {
    for (let z = 3; z < WORLD_SZ - 3; z++) {
      const h = surfaceHeight(seed, x, z);
      if (store.getBlock(x, h, z) !== GRASS) continue;
      if (hash2(seed ^ 0x2545f491, x, z) < TREE_CHANCE) plantTree(store, rand, x, h + 1, z);
    }
  }
}

/**
 * Spawn point: the dry, tree-free surface column closest to the world center
 * (never underwater — some seeds put an ocean at the center).
 */
export function spawnPoint(seed: number): { x: number; y: number; z: number } {
  const cx = WORLD_SX >> 1;
  const cz = WORLD_SZ >> 1;
  let best: { x: number; y: number; z: number } | null = null;
  let bestDist = Infinity;
  for (let x = 3; x < WORLD_SX - 3; x += 2)
    for (let z = 3; z < WORLD_SZ - 3; z += 2) {
      const h = surfaceHeight(seed, x, z);
      if (h <= SEA_LEVEL) continue;
      if (hash2(seed ^ 0x2545f491, x, z) < TREE_CHANCE) continue; // tree here
      const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d < bestDist) {
        bestDist = d;
        best = { x: x + 0.5, y: h + 2, z: z + 0.5 };
      }
    }
  return best ?? { x: cx + 0.5, y: WORLD_SY - 8, z: cz + 0.5 };
}
