// Deterministic 2D terrain: surface hills, dirt/stone bands, worm caves,
// ore pockets, lakes, trees. Same seed => byte-identical world everywhere.

import {
  AIR,
  BEDROCK,
  DIRT,
  GRASS,
  LEAVES,
  ORE_COAL,
  ORE_GOLD,
  ORE_IRON,
  SAND,
  STONE,
  WATER,
  WOOD,
} from "./tiles";
import { TileStore, WORLD_H, WORLD_W } from "./world";

/** mulberry32 PRNG — deterministic across JS engines */
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

/** deterministic hash of (seed, x, y) -> [0, 1) */
export function hash2(seed: number, x: number, y: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x * 374761393), 668265263) >>> 0;
  h = Math.imul(h ^ (y * 2246822519), 3266489917) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2654435761) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 1D value noise along x */
export function valueNoise1(seed: number, x: number, scale: number): number {
  const fx = x / scale;
  const x0 = Math.floor(fx);
  const t = smooth(fx - x0);
  const a = hash2(seed, x0, 0);
  const b = hash2(seed, x0 + 1, 0);
  return a + (b - a) * t;
}

const LAKE_LEVEL = 74;

/** surface line: y of the top solid tile at column x (y grows DOWNWARD) */
export function surfaceY(seed: number, x: number): number {
  const n =
    valueNoise1(seed, x, 90) * 0.5 +
    valueNoise1(seed ^ 0x9e3779b9, x, 34) * 0.35 +
    valueNoise1(seed ^ 0x51ab7cd3, x, 11) * 0.15;
  const y = Math.floor(46 + n * 44); // 46..90
  return Math.min(WORLD_H - 20, Math.max(12, y));
}

const TREE_CHANCE = 0.05;

function plantTree(store: TileStore, rand: () => number, x: number, groundY: number): void {
  const height = 4 + Math.floor(rand() * 3); // 4-6
  for (let i = 1; i <= height; i++) store.setGenerated(x, groundY - i, WOOD);
  const top = groundY - height;
  for (let dy = -2; dy <= 1; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.max(0, -dy) > 3) continue;
      const tx = x + dx,
        ty = top + dy;
      if (store.getTile(tx, ty) === AIR) store.setGenerated(tx, ty, LEAVES);
    }
}

function carveCaves(store: TileStore, seed: number): void {
  const rand = mulberry32(seed ^ 0x6c1e5a2f);
  const worms = 30;
  for (let w = 0; w < worms; w++) {
    let x = 10 + rand() * (WORLD_W - 20);
    let y = 100 + rand() * 80;
    let angle = rand() * Math.PI * 2;
    const length = 40 + rand() * 100;
    for (let i = 0; i < length; i++) {
      const r = 1 + rand() * 2;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const cx = Math.floor(x + dx),
            cy = Math.floor(y + dy);
          // never carve the surface open or the bedrock floor
          if (cy < surfaceY(seed, cx) + 4 || cy >= WORLD_H - 2) continue;
          if (store.getTile(cx, cy) !== AIR) store.setGenerated(cx, cy, AIR);
        }
      angle += (rand() - 0.5) * 0.8;
      x += Math.cos(angle) * 2;
      y += Math.sin(angle) * 1.4;
      if (x < 4 || x > WORLD_W - 4 || y < 20 || y > WORLD_H - 4) break;
    }
  }
}

function sprinkleOres(store: TileStore, seed: number): void {
  for (let x = 0; x < WORLD_W; x++) {
    const s = surfaceY(seed, x);
    for (let y = s + 6; y < WORLD_H - 2; y++) {
      if (store.getTile(x, y) !== STONE) continue;
      const depth = (y - s) / (WORLD_H - s);
      const h = hash2(seed ^ 0x2545f491, x, y);
      if (h < 0.015) store.setGenerated(x, y, ORE_COAL);
      else if (h < 0.022 && depth > 0.3) store.setGenerated(x, y, ORE_IRON);
      else if (h < 0.025 && depth > 0.6) store.setGenerated(x, y, ORE_GOLD);
    }
  }
}

export function generateWorld(store: TileStore, seed: number): void {
  // pass 1: columns
  for (let x = 0; x < WORLD_W; x++) {
    const s = surfaceY(seed, x);
    const nearLake = s >= LAKE_LEVEL - 1;
    for (let y = 0; y < WORLD_H; y++) {
      let t = AIR;
      if (y >= WORLD_H - 2) t = BEDROCK;
      else if (y > s + 6) t = STONE;
      else if (y > s) t = DIRT;
      else if (y === s) t = nearLake ? SAND : GRASS;
      else if (y >= LAKE_LEVEL && y < s) t = WATER; // depression below lake level
      store.setGenerated(x, y, t);
    }
  }
  // pass 2: caves, ores, trees
  carveCaves(store, seed);
  sprinkleOres(store, seed);
  const rand = mulberry32(seed ^ 0x7f4a7c15);
  for (let x = 4; x < WORLD_W - 4; x++) {
    const s = surfaceY(seed, x);
    if (store.getTile(x, s) !== GRASS) continue;
    if (hash2(seed ^ 0x8b0f1a2d, x, 0) < TREE_CHANCE) plantTree(store, rand, x, s);
  }
}

/** spawn: dry, tree-free surface column closest to the world center */
export function spawnPoint(seed: number): { x: number; y: number } {
  const cx = WORLD_W >> 1;
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (let x = 6; x < WORLD_W - 6; x += 2) {
    const s = surfaceY(seed, x);
    if (s >= LAKE_LEVEL - 1) continue; // lakeside / underwater
    if (hash2(seed ^ 0x8b0f1a2d, x, 0) < TREE_CHANCE) continue;
    const d = Math.abs(x - cx);
    if (d < bestDist) {
      bestDist = d;
      best = { x: x + 0.5, y: s - 2.5 };
    }
  }
  return best ?? { x: cx + 0.5, y: 10 };
}
