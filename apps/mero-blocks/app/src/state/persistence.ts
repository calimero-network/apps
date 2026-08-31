// Offline-first persistence: seed + override diff + player pose, per world.

export interface SavedPlayer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  sel: number;
  name: string;
}

export interface SaveData {
  seed: number;
  name: string;
  overrides: Record<string, number>;
  player: SavedPlayer | null;
  savedAt: number;
}

const keyFor = (worldId: string) => `mero-blocks/${worldId}`;

export function saveWorld(worldId: string, data: SaveData): void {
  try {
    localStorage.setItem(keyFor(worldId), JSON.stringify(data));
  } catch {
    /* quota exceeded — skip this save, next one may fit after cleanup */
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
    /* nothing to delete */
  }
}

export function listWorlds(): { worldId: string; data: SaveData }[] {
  const out: { worldId: string; data: SaveData }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("mero-blocks/")) continue;
    const data = loadWorld(key.slice("mero-blocks/".length));
    if (data) out.push({ worldId: key.slice("mero-blocks/".length), data });
  }
  return out.sort((a, b) => b.data.savedAt - a.data.savedAt);
}
