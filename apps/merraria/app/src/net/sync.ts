// SyncEngine — 2D twin of mero-blocks': timer-free (game loop drives tick()),
// edit batching with per-key LWW, echo suppression, event-nudge + poll model.
// The loop is a requestAnimationFrame one, so nothing ticks while the tab is
// hidden.
//
// Given a presence channel (the web build), player positions travel there and
// the contract is only told who joined and left. Without one (the iOS/Android
// apps' bridge), they go through contract heartbeats and a roster poll.

import { Edit, TileStore, tileKey } from "../engine/world";
import { GameEvent } from "./events";
import { readAllOverrides, type WorldCalls } from "./merraria";

export const FLUSH_MS = 150;
/** active players save their location every 500ms so the map tracks them live */
export const HEARTBEAT_MOVING_MS = 500;
export const HEARTBEAT_IDLE_MS = 3000;
export const PLAYERS_POLL_MS = 500;
/**
 * The safety-net re-read of every edit: events already pull a peer's edits,
 * and a reconnect reconciles, so this only catches one missed in between.
 */
export const OVERRIDES_POLL_MS = 30_000;
/** Presence: at most one publish per this while the transform changes. */
export const PRESENCE_MOVING_MS = 150;
/** Presence: re-publish an unchanged transform this often (an entry lapses after 7 s). */
export const PRESENCE_REFRESH_MS = 3000;

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

/** What one device publishes over presence: its player id and transform. */
export interface PresenceSlice extends Transform {
  id: string;
}

/**
 * The world's ephemeral presence channel: where each device's player stands.
 * `publish(null)` retracts this device's entry.
 */
export interface PresenceChannel {
  publish(slice: PresenceSlice | null): void;
  /** Every present player (this device's own included), on each change, until the returned stop. */
  subscribe(onPlayers: (players: RemotePlayer[]) => void): () => void;
}

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
  private overridesClock = 0;
  private flushing = false;
  /** A pull in flight, and whether another was asked for meanwhile (coalesced). */
  private pulling: Promise<number> | null = null;
  private pullAgain = false;
  /** The last transform published over presence, and the stop of the presence stream. */
  private published = "";
  private stopPresence: (() => void) | null = null;

  constructor(
    private calls: WorldCalls,
    private world: TileStore,
    private myId: () => string | null,
    private cb: SyncCallbacks = {},
    /** Player positions over presence instead of `heartbeat` and `getPlayers` polls. */
    private presence: PresenceChannel | null = null,
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
      await this.calls.setTiles({ edits: batch, now: nowSecs() });
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

  /**
   * Pull the authoritative override set and apply the diff locally. Pulls are
   * coalesced: asked for while one is in flight (a burst of `TilesChanged`, or
   * the events replayed after a reconnect), it runs once more afterwards
   * instead of once per event.
   */
  async pullOverrides(): Promise<number> {
    if (this.pulling) {
      this.pullAgain = true;
      return this.pulling;
    }
    this.pulling = (async () => {
      let applied = 0;
      do {
        this.pullAgain = false;
        try {
          applied += await this.readOverrides();
        } catch (err) {
          this.cb.onError?.(err);
        }
      } while (this.pullAgain);
      return applied;
    })();
    try {
      return await this.pulling;
    } finally {
      this.pulling = null;
    }
  }

  /** `pullOverrides` that throws, for callers that must know the read happened. */
  private async readOverrides(): Promise<number> {
    const entries = await readAllOverrides(this.calls);
    let applied = 0;
    for (const { k, t } of entries ?? []) {
      if (this.pending.has(k)) continue;
      const [x, y] = k.split(",").map(Number);
      if (this.world.applyOverride(x, y, t)) applied++;
    }
    if (applied > 0) this.cb.onRemoteEdits?.(applied);
    return applied;
  }

  async pullPlayers(): Promise<void> {
    if (this.presence) return; // the presence stream keeps the roster
    try {
      const players = (await this.calls.getPlayers({ now: nowSecs() })) as RemotePlayer[];
      const me = this.myId();
      this.cb.onPlayers?.((players ?? []).filter((p) => p.id !== me && p.online));
    } catch (err) {
      this.cb.onError?.(err);
    }
  }

  async join(name: string): Promise<void> {
    await this.calls.join({ name, now: nowSecs() });
  }

  /** Follow the presence channel, when there is one. Idempotent. */
  followPresence(): void {
    const presence = this.presence;
    if (!presence || this.stopPresence) return;
    this.stopPresence = presence.subscribe((players) => {
      const me = this.myId();
      this.cb.onPlayers?.(players.filter((p) => p.id !== me && p.online));
    });
  }

  async leave(): Promise<void> {
    this.stopPresence?.();
    this.stopPresence = null;
    this.presence?.publish(null);
    try {
      await this.calls.leave({ now: nowSecs() });
    } catch {
      /* best-effort — we age out of the presence TTL anyway */
    }
  }

  /**
   * Join the world and read its edits, retrying until the node answers both.
   *
   * Right after a world is created its founding `createWorld` may not have
   * landed yet, and the contract answers `NoWorld` until it has; a dropped
   * connection fails the same way. Giving up on the first refusal left a
   * world unloaded for good. Resolves true once the
   * world is joined and read, or false if `isCurrent` says it was left first.
   */
  async connect(name: string, retryMs: number, isCurrent: () => boolean = () => true): Promise<boolean> {
    while (isCurrent()) {
      try {
        await this.join(name);
        this.followPresence();
        await this.readOverrides();
        await this.pullPlayers();
        await this.flush();
        return true;
      } catch (err) {
        this.cb.onError?.(err);
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
    return false;
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
    this.overridesClock += dtMs;

    if (this.flushClock >= FLUSH_MS) {
      this.flushClock = 0;
      void this.flush();
    }
    if (this.presence) {
      this.tickPresence(this.presence, transform);
    } else {
      const hbInterval = moving ? HEARTBEAT_MOVING_MS : HEARTBEAT_IDLE_MS;
      if (transform && this.heartbeatClock >= hbInterval) {
        this.heartbeatClock = 0;
        void this.calls.heartbeat({ t: quantize(transform), now: nowSecs() }).catch((err) =>
          this.cb.onError?.(err),
        );
      }
    }
    if (!this.presence && this.playersClock >= PLAYERS_POLL_MS) {
      this.playersClock = 0;
      void this.pullPlayers();
    }
    if (this.overridesClock >= OVERRIDES_POLL_MS && !this.flushing) {
      this.overridesClock = 0;
      void this.pullOverrides();
    }
  }

  /** Publish the transform when it changed (throttled), else refresh it before it lapses. */
  private tickPresence(presence: PresenceChannel, transform: Transform | null): void {
    const id = this.myId();
    if (!transform || !id) return;
    const slice = { ...quantize(transform), id };
    const key = JSON.stringify(slice);
    const due = key === this.published ? PRESENCE_REFRESH_MS : PRESENCE_MOVING_MS;
    if (this.heartbeatClock < due) return;
    this.heartbeatClock = 0;
    this.published = key;
    presence.publish(slice);
  }
}

export function quantize(t: Transform): Transform {
  const q = (v: number) => Math.round(v * 100) / 100;
  return { ...t, x: q(t.x), y: q(t.y) };
}
