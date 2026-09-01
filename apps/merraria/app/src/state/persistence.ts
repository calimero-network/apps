// Offline-first persistence: seed + override diff + player + inventory.

import { PLAYER_H, PLAYER_HALF_W } from "../engine/physics";
import { WORLD_H, WORLD_W } from "../engine/world";

export interface SavedPlayer {
  x: number;
  y: number;
  sel: number;
  name: string;
}

export interface SaveData {
  seed: number;
  name: string;
  overrides: Record<string, number>;
  inventory: Record<number, number>;
  player: SavedPlayer | null;
  savedAt: number;
}

const keyFor = (worldId: string) => `merraria/${worldId}`;

export function saveWorld(worldId: string, data: SaveData): void {
  try {
    localStorage.setItem(keyFor(worldId), JSON.stringify(data));
  } catch {
    /* quota exceeded — skip this save */
  }
}

export function loadWorld(worldId: string): SaveData | null {
  try {
    const raw = localStorage.getItem(keyFor(worldId));
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (typeof data.seed !== "number" || typeof data.overrides !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

export function deleteWorld(worldId: string): void {
  try {
    localStorage.removeItem(keyFor(worldId));
  } catch {
    /* storage unavailable — nothing to delete anyway */
  }
}

export function hasWorld(worldId: string): boolean {
  return loadWorld(worldId) !== null;
}

/**
 * Is the saved position actually inside the world? Saves from before the
 * map-edge walls could have the player outside the map (fell off the edge,
 * falling forever) — loading such a save must respawn instead of restoring.
 */
export function playerInBounds(p: SavedPlayer | null | undefined): p is SavedPlayer {
  if (!p || typeof p.x !== "number" || typeof p.y !== "number") return false;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  return (
    p.x >= PLAYER_HALF_W &&
    p.x <= WORLD_W - PLAYER_HALF_W &&
    p.y >= PLAYER_H && // y is the feet; the head must be inside the map too
    p.y <= WORLD_H
  );
}
