// WorldStore: fixed-size voxel world = deterministic terrain + override diff.
// The override map is the ONLY thing that is networked or persisted.

import { AIR } from "./blocks";

export const CHUNK = 16;
export const WORLD_CX = 8; // chunks along x
export const WORLD_CY = 4; // chunks along y
export const WORLD_CZ = 8; // chunks along z
export const WORLD_SX = WORLD_CX * CHUNK; // 128
export const WORLD_SY = WORLD_CY * CHUNK; // 64
export const WORLD_SZ = WORLD_CZ * CHUNK; // 128
export const SEA_LEVEL = 22;

export const chunkKey = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
export const blockKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function parseBlockKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(",").map(Number);
  return [x, y, z];
}

export interface Edit {
  x: number;
  y: number;
  z: number;
  b: number;
}

export class WorldStore {
  /** chunk key -> 4096 block ids (x + z*16 + y*256) */
  chunks = new Map<string, Uint8Array>();
  /** block key -> block id; the networked/persisted diff vs generated terrain */
  overrides = new Map<string, number>();
  /** chunk keys needing remesh */
  dirty = new Set<string>();
  /** columns needing a relight pass (drained by the game loop) */
  pendingRelights: [number, number][] = [];

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < WORLD_SX && y < WORLD_SY && z < WORLD_SZ;
  }

  chunkOf(x: number, y: number, z: number): Uint8Array {
    const key = chunkKey(x >> 4, y >> 4, z >> 4);
    let c = this.chunks.get(key);
    if (!c) {
      c = new Uint8Array(CHUNK * CHUNK * CHUNK);
      this.chunks.set(key, c);
    }
    return c;
  }

  static voxelIndex(x: number, y: number, z: number): number {
    return (x & 15) + ((z & 15) << 4) + ((y & 15) << 8);
  }

  getBlock(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return AIR;
    const c = this.chunks.get(chunkKey(x >> 4, y >> 4, z >> 4));
    if (!c) return AIR;
    return c[WorldStore.voxelIndex(x, y, z)];
  }

  /** Raw write used by the terrain generator — does NOT record an override. */
  setGenerated(x: number, y: number, z: number, b: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.chunkOf(x, y, z)[WorldStore.voxelIndex(x, y, z)] = b;
  }

  /**
   * Player/network edit — records the override and marks affected chunks
   * dirty (including neighbors when the block sits on a chunk border).
   */
  setBlock(x: number, y: number, z: number, b: number): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const cur = this.getBlock(x, y, z);
    if (cur === b) return false;
    this.chunkOf(x, y, z)[WorldStore.voxelIndex(x, y, z)] = b;
    this.overrides.set(blockKey(x, y, z), b);
    this.markDirtyAround(x, y, z);
    this.pendingRelights.push([x, z]);
    return true;
  }

  /** Apply a remote/persisted override (same as setBlock; kept for intent). */
  applyOverride(x: number, y: number, z: number, b: number): boolean {
    return this.setBlock(x, y, z, b);
  }

  markDirtyAround(x: number, y: number, z: number): void {
    const cx = x >> 4,
      cy = y >> 4,
      cz = z >> 4;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          // only neighbor chunks the edit actually touches (border faces)
          if (dx === -1 && (x & 15) !== 0) continue;
          if (dx === 1 && (x & 15) !== 15) continue;
          if (dy === -1 && (y & 15) !== 0) continue;
          if (dy === 1 && (y & 15) !== 15) continue;
          if (dz === -1 && (z & 15) !== 0) continue;
          if (dz === 1 && (z & 15) !== 15) continue;
          const nx = cx + dx,
            ny = cy + dy,
            nz = cz + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= WORLD_CX || ny >= WORLD_CY || nz >= WORLD_CZ)
            continue;
          this.dirty.add(chunkKey(nx, ny, nz));
        }
  }

  markAllDirty(): void {
    for (let cx = 0; cx < WORLD_CX; cx++)
      for (let cy = 0; cy < WORLD_CY; cy++)
        for (let cz = 0; cz < WORLD_CZ; cz++) this.dirty.add(chunkKey(cx, cy, cz));
  }

  takeDirty(): string[] {
    const keys = [...this.dirty];
    this.dirty.clear();
    return keys;
  }

  overridesToJSON(): Record<string, number> {
    return Object.fromEntries(this.overrides);
  }

  applyOverridesJSON(json: Record<string, number>): number {
    let applied = 0;
    for (const [key, b] of Object.entries(json)) {
      const [x, y, z] = parseBlockKey(key);
      if (this.applyOverride(x, y, z, b)) applied++;
    }
    return applied;
  }
}
