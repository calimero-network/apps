// Mining: hold to dig with per-tile hardness, reach checks, and an inventory
// that gains what you mine and spends what you place.

import { AIR, breakable, tileDef } from "./tiles";
import { TileStore } from "./world";

export const REACH_TILES = 5;

export interface DigState {
  x: number;
  y: number;
  /** 0..1 */
  progress: number;
}

export class Inventory {
  counts = new Map<number, number>();

  constructor(initial: Record<number, number> = {}) {
    for (const [id, n] of Object.entries(initial)) this.counts.set(Number(id), n);
  }

  count(id: number): number {
    return this.counts.get(id) ?? 0;
  }

  add(id: number, n = 1): void {
    this.counts.set(id, this.count(id) + n);
  }

  /** returns false when there is nothing to spend */
  spend(id: number, n = 1): boolean {
    if (this.count(id) < n) return false;
    this.counts.set(id, this.count(id) - n);
    return true;
  }

  toJSON(): Record<number, number> {
    return Object.fromEntries(this.counts);
  }
}

export function withinReach(px: number, py: number, tx: number, ty: number): boolean {
  const dx = tx + 0.5 - px;
  const dy = ty + 0.5 - py;
  return dx * dx + dy * dy <= REACH_TILES * REACH_TILES;
}

/**
 * Advance digging at (x, y) by dt seconds. Returns the mined tile id when the
 * tile breaks this tick, else null. `dig` carries progress between ticks and
 * resets when the target moves.
 */
export function digTick(
  store: TileStore,
  inv: Inventory,
  dig: DigState,
  x: number,
  y: number,
  dt: number,
): number | null {
  const tile = store.getTile(x, y);
  if (tile === AIR || !breakable(tile)) {
    dig.progress = 0;
    return null;
  }
  if (dig.x !== x || dig.y !== y) {
    dig.x = x;
    dig.y = y;
    dig.progress = 0;
  }
  dig.progress += dt / tileDef(tile).hardness;
  if (dig.progress < 1) return null;
  dig.progress = 0;
  store.setTile(x, y, AIR);
  const drop = tileDef(tile).drops;
  inv.add(drop);
  return tile;
}

/** place `id` at (x, y) if the cell is free and the inventory allows it */
export function place(store: TileStore, inv: Inventory, x: number, y: number, id: number): boolean {
  const cur = store.getTile(x, y);
  if (cur !== AIR && tileDef(cur).solid) return false;
  if (!inv.spend(id)) return false;
  if (!store.setTile(x, y, id)) {
    inv.add(id); // refund the no-op
    return false;
  }
  return true;
}
