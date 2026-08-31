// SyncEngine — 2D twin of mero-blocks': timer-free (game loop drives tick()),
// edit batching with per-key LWW, echo suppression, event-nudge + poll model.

import { Edit, TileStore, tileKey } from "../engine/world";
import { GameEvent } from "./events";

export const FLUSH_MS = 150;
/** active players save their location every 500ms so the map tracks them live */
export const HEARTBEAT_MOVING_MS = 500;
export const HEARTBEAT_IDLE_MS = 3000;
export const PLAYERS_POLL_MS = 500;

export type PlayerAction = "idle" | "walking" | "mining" | "building" | "swimming";

export interface Transform {
  name: string;
  x: number;
  y: number;
  dir: number; // -1 | 1 facing
  sel: number;
  action: PlayerAction;
}

export interface RemotePlayer extends Transform {
  id: string;
  online: boolean;
}

export type ExecFn = <T = unknown>(method: string, args: Record<string, unknown>) => Promise<T>;

export interface SyncCallbacks {
  onRemoteEdits?: (applied: number) => void;
  onPlayers?: (players: RemotePlayer[]) => void;
  onToast?: (msg: string) => void;
  onError?: (err: unknown) => void;
}

export const nowSecs = () => Math.floor(Date.now() / 1000);

export class SyncEngine {
  pending = new Map<string, Edit>();
  private flushClock = 0;
  private heartbeatClock = 0;
  private playersClock = 0;
  private flushing = false;

  constructor(
    private exec: ExecFn,
    private world: TileStore,
    private myId: () => string | null,
    private cb: SyncCallbacks = {},
  ) {}

  queueEdit(x: number, y: number, t: number): void {
    this.pending.set(tileKey(x, y), { x, y, t });
  }

  async flush(): Promise<void> {
    if (this.flushing || this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    const keys = [...this.pending.keys()];
    this.pending.clear();
    this.flushing = true;
    try {
      await this.exec("set_tiles", { edits: batch, now: nowSecs() });
    } catch (err) {
      for (let i = 0; i < batch.length; i++) {
        if (!this.pending.has(keys[i])) this.pending.set(keys[i], batch[i]);
      }
      this.cb.onError?.(err);
    } finally {
      this.flushing = false;
    }
  }

  handleEvent(ev: GameEvent): void {
    switch (ev.kind) {
      case "TilesChanged": {
        const by = typeof ev.value === "string" ? ev.value : "";
        if (by && by === this.myId()) return;
        void this.pullOverrides();
        break;
      }
      case "PlayerJoined": {
        const id = typeof ev.value === "string" ? ev.value : "";
        if (id !== this.myId()) this.cb.onToast?.("A player joined");
        void this.pullPlayers();
        break;
      }
      case "PlayerLeft": {
        const id = typeof ev.value === "string" ? ev.value : "";
        if (id !== this.myId()) this.cb.onToast?.("A player left");
        void this.pullPlayers();
        break;
      }
      default:
        break;
    }
  }

  async pullOverrides(): Promise<number> {
    try {
      const entries = await this.exec<{ k: string; t: number }[]>("get_overrides", {});
      let applied = 0;
      for (const { k, t } of entries ?? []) {
        if (this.pending.has(k)) continue;
        const [x, y] = k.split(",").map(Number);
        if (this.world.applyOverride(x, y, t)) applied++;
      }
      if (applied > 0) this.cb.onRemoteEdits?.(applied);
      return applied;
    } catch (err) {
      this.cb.onError?.(err);
      return 0;
    }
  }

  async pullPlayers(): Promise<void> {
    try {
      const players = await this.exec<RemotePlayer[]>("get_players", { now: nowSecs() });
      const me = this.myId();
      this.cb.onPlayers?.((players ?? []).filter((p) => p.id !== me && p.online));
    } catch (err) {
      this.cb.onError?.(err);
    }
  }

  async join(name: string): Promise<void> {
    await this.exec("join", { name, now: nowSecs() });
  }

  async leave(): Promise<void> {
    try {
      await this.exec("leave", { now: nowSecs() });
    } catch {
      /* best-effort — reap collects us */
    }
  }

  async reconcile(): Promise<void> {
    await this.pullOverrides();
    await this.pullPlayers();
    await this.flush();
  }

  tick(dtMs: number, transform: Transform | null, moving: boolean): void {
    this.flushClock += dtMs;
    this.heartbeatClock += dtMs;
    this.playersClock += dtMs;

    if (this.flushClock >= FLUSH_MS) {
      this.flushClock = 0;
      void this.flush();
    }
    const hbInterval = moving ? HEARTBEAT_MOVING_MS : HEARTBEAT_IDLE_MS;
    if (transform && this.heartbeatClock >= hbInterval) {
      this.heartbeatClock = 0;
      void this.exec("heartbeat", { t: quantize(transform), now: nowSecs() }).catch((err) =>
        this.cb.onError?.(err),
      );
    }
    if (this.playersClock >= PLAYERS_POLL_MS) {
      this.playersClock = 0;
      void this.pullPlayers();
    }
  }
}

export function quantize(t: Transform): Transform {
  const q = (v: number) => Math.round(v * 100) / 100;
  return { ...t, x: q(t.x), y: q(t.y) };
}
