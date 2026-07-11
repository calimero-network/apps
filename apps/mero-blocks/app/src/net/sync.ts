// SyncEngine: the one place where the game talks to the contract.
// Deterministic and timer-free — the game loop calls tick(dtMs, …), so every
// behavior (batching, heartbeats, polling) is unit-testable without fake
// timers, and heartbeats can never die inside a stale closure (the mero-meet
// "heartbeats never fired" lesson).

import { blockKey, WorldStore, Edit } from "../engine/world";
import { GameEvent } from "./events";

export const FLUSH_MS = 150;
export const HEARTBEAT_MOVING_MS = 1000;
export const HEARTBEAT_IDLE_MS = 3000;
export const PLAYERS_POLL_MS = 1500;

export interface Transform {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  sel: number;
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
  /** pending local edits, last-write-wins per block key */
  pending = new Map<string, Edit>();
  private flushClock = 0;
  private heartbeatClock = 0;
  private playersClock = 0;
  private flushing = false;

  constructor(
    private exec: ExecFn,
    private world: WorldStore,
    private myId: () => string | null,
    private cb: SyncCallbacks = {},
  ) {}

  // ---- outbound edits ------------------------------------------------

  queueEdit(x: number, y: number, z: number, b: number): void {
    this.pending.set(blockKey(x, y, z), { x, y, z, b });
  }

  async flush(): Promise<void> {
    if (this.flushing || this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    const keys = [...this.pending.keys()];
    this.pending.clear();
    this.flushing = true;
    try {
      await this.exec("set_blocks", { edits: batch, now: nowSecs() });
    } catch (err) {
      // requeue, but never clobber an edit the player made while in flight
      for (let i = 0; i < batch.length; i++) {
        if (!this.pending.has(keys[i])) this.pending.set(keys[i], batch[i]);
      }
      this.cb.onError?.(err);
    } finally {
      this.flushing = false;
    }
  }

  // ---- inbound -------------------------------------------------------

  handleEvent(ev: GameEvent): void {
    switch (ev.kind) {
      case "BlocksChanged": {
        const by = typeof ev.value === "string" ? ev.value : "";
        if (by && by === this.myId()) return; // our own echo
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

  /** pull the authoritative override set and apply the diff locally */
  async pullOverrides(): Promise<number> {
    try {
      const entries = await this.exec<{ k: string; b: number }[]>("get_overrides", {});
      let applied = 0;
      for (const { k, b } of entries ?? []) {
        if (this.pending.has(k)) continue; // our unsent edit is newer locally
        const [x, y, z] = k.split(",").map(Number);
        if (this.world.applyOverride(x, y, z, b)) applied++;
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

  // ---- session -------------------------------------------------------

  async join(name: string): Promise<void> {
    await this.exec("join", { name, now: nowSecs() });
  }

  async leave(): Promise<void> {
    try {
      await this.exec("leave", { now: nowSecs() });
    } catch {
      /* leaving best-effort — reap will collect us */
    }
  }

  /** initial reconcile: pull world + roster, then push anything pending */
  async reconcile(): Promise<void> {
    await this.pullOverrides();
    await this.pullPlayers();
    await this.flush();
  }

  // ---- game-loop driven timers ----------------------------------------

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

/** shrink transform payloads: cm precision for position, mrad for angles */
export function quantize(t: Transform): Transform {
  const q = (v: number, s: number) => Math.round(v * s) / s;
  return {
    ...t,
    x: q(t.x, 100),
    y: q(t.y, 100),
    z: q(t.z, 100),
    yaw: q(t.yaw, 1000),
    pitch: q(t.pitch, 1000),
  };
}
