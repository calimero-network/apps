// TileStore: fixed 2D tile world = deterministic terrain + override diff.
// y = 0 is the sky (top), y = WORLD_H - 1 is the bedrock floor.
// The override map is the ONLY thing networked or persisted.

import { AIR } from "./tiles";

export const WORLD_W = 400;
export const WORLD_H = 200;

export const tileKey = (x: number, y: number) => `${x},${y}`;

export function parseTileKey(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

export interface Edit {
  x: number;
  y: number;
  t: number;
}

export class TileStore {
  tiles = new Uint8Array(WORLD_W * WORLD_H);
  /** tile key -> tile id; the networked/persisted diff vs generated terrain */
  overrides = new Map<string, number>();
  /** set when any tile changed since the last light recompute */
  lightDirty = true;

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H;
  }

  getTile(x: number, y: number): number {
    if (!this.inBounds(x, y)) return AIR;
    return this.tiles[x + y * WORLD_W];
  }

  /** Raw write used by the terrain generator — does NOT record an override. */
  setGenerated(x: number, y: number, t: number): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[x + y * WORLD_W] = t;
  }

  /** Player/network edit — records the override and marks lighting dirty. */
  setTile(x: number, y: number, t: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (this.tiles[x + y * WORLD_W] === t) return false;
    this.tiles[x + y * WORLD_W] = t;
    this.overrides.set(tileKey(x, y), t);
    this.lightDirty = true;
    return true;
  }

  applyOverride(x: number, y: number, t: number): boolean {
    return this.setTile(x, y, t);
  }

  overridesToJSON(): Record<string, number> {
    return Object.fromEntries(this.overrides);
  }

  applyOverridesJSON(json: Record<string, number>): number {
    let applied = 0;
    for (const [key, t] of Object.entries(json)) {
      const [x, y] = parseTileKey(key);
      if (this.applyOverride(x, y, t)) applied++;
    }
    return applied;
  }
}
