// Offline-first persistence: seed + override diff + player + inventory.

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
