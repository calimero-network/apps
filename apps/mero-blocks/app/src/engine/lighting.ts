// Voxel lighting: 16-level sunlight + block light (torches/glowstone), stored
// in world-sized grids and baked into chunk meshes as per-vertex attributes.
// Day/night only scales the SUN component at render time (see sim.ts), so no
// remesh is needed as time passes.

import { emissive, isOpaque } from "./blocks";
import { chunkKey, WORLD_SX, WORLD_SY, WORLD_SZ, WorldStore } from "./world";

const SIZE = WORLD_SX * WORLD_SY * WORLD_SZ;

const idx = (x: number, y: number, z: number) => x + z * WORLD_SX + y * WORLD_SX * WORLD_SZ;

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export class LightGrid {
  sun = new Uint8Array(SIZE);
  block = new Uint8Array(SIZE);
  /** chunk keys whose light changed during the last relight pass */
  changedChunks = new Set<string>();

  sunAt(x: number, y: number, z: number): number {
    if (y >= WORLD_SY) return 15; // open sky
    if (x < 0 || z < 0 || y < 0 || x >= WORLD_SX || z >= WORLD_SZ) return 15;
    return this.sun[idx(x, y, z)];
  }

  blockAt(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= WORLD_SX || y >= WORLD_SY || z >= WORLD_SZ) return 0;
    return this.block[idx(x, y, z)];
  }

  private write(grid: Uint8Array, x: number, y: number, z: number, v: number): void {
    const i = idx(x, y, z);
    if (grid[i] === v) return;
    grid[i] = v;
    this.changedChunks.add(chunkKey(x >> 4, y >> 4, z >> 4));
  }

  recomputeAll(store: WorldStore): void {
    this.relightRegion(store, 0, WORLD_SX - 1, 0, WORLD_SZ - 1);
  }

  /**
   * Relight after an edit at (x, _, z): recompute the full-height column
   * region within `radius` in x/z. Full height because placing a block can
   * shadow the sun column all the way down; radius 16 >= max spread (15).
   */
  relightAround(store: WorldStore, x: number, z: number, radius = 16): void {
    this.relightRegion(
      store,
      Math.max(0, x - radius),
      Math.min(WORLD_SX - 1, x + radius),
      Math.max(0, z - radius),
      Math.min(WORLD_SZ - 1, z + radius),
    );
  }

  takeChangedChunks(): string[] {
    const keys = [...this.changedChunks];
    this.changedChunks.clear();
    return keys;
  }

  private relightRegion(store: WorldStore, x0: number, x1: number, z0: number, z1: number): void {
    // clear region
    for (let y = 0; y < WORLD_SY; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          this.write(this.sun, x, y, z, 0);
          this.write(this.block, x, y, z, 0);
        }

    const sunQ: number[] = [];
    const blockQ: number[] = [];

    // columnar sunlight: 15 straight down until an opaque block
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        for (let y = WORLD_SY - 1; y >= 0; y--) {
          if (isOpaque(store.getBlock(x, y, z))) break;
          this.write(this.sun, x, y, z, 15);
          sunQ.push(idx(x, y, z));
        }
      }

    // emissive seeds inside the region
    for (let y = 0; y < WORLD_SY; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const e = emissive(store.getBlock(x, y, z));
          if (e > 0) {
            this.write(this.block, x, y, z, e);
            blockQ.push(idx(x, y, z));
          }
        }

    // boundary seeds: light entering the region from just outside it
    const seedBoundary = (bx: number, bz: number) => {
      if (bx < 0 || bz < 0 || bx >= WORLD_SX || bz >= WORLD_SZ) return;
      for (let y = 0; y < WORLD_SY; y++) {
        const i = idx(bx, y, bz);
        if (this.sun[i] > 1) sunQ.push(i);
        if (this.block[i] > 1) blockQ.push(i);
      }
    };
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      seedBoundary(x, z0 - 1);
      seedBoundary(x, z1 + 1);
    }
    for (let z = z0; z <= z1; z++) {
      seedBoundary(x0 - 1, z);
      seedBoundary(x1 + 1, z);
    }

    this.bfs(store, this.sun, sunQ);
    this.bfs(store, this.block, blockQ);
  }

  /** monotone-max flood fill: light spreads to non-opaque cells at level-1 */
  private bfs(store: WorldStore, grid: Uint8Array, queue: number[]): void {
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      const level = grid[i];
      if (level <= 1) continue;
      const y = Math.floor(i / (WORLD_SX * WORLD_SZ));
      const z = Math.floor((i - y * WORLD_SX * WORLD_SZ) / WORLD_SX);
      const x = i - y * WORLD_SX * WORLD_SZ - z * WORLD_SX;
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = x + dx,
          ny = y + dy,
          nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= WORLD_SX || ny >= WORLD_SY || nz >= WORLD_SZ)
          continue;
        if (isOpaque(store.getBlock(nx, ny, nz))) continue;
        const ni = idx(nx, ny, nz);
        const next = level - 1;
        if (grid[ni] < next) {
          this.write(grid, nx, ny, nz, next);
          queue.push(ni);
        }
      }
    }
  }
}
