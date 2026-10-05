// GameClient: contract calls + the event subscription for the current world,
// over whichever transport the session is (net/transport.ts).

import {
  AuthRevokedError,
  type GroupMembershipEventData,
  type GroupMigrationEventData,
  type SseEventData,
} from "@calimero-network/mero-js";
import { clearSession, getSession } from "./session";
import { getTransport, type EventStream } from "./transport";
import { decodeSseEvents, GameEvent } from "./events";

/** How long after a reconnect to wait before re-reading the world. */
const RESYNC_DELAY_MS = 500;

export interface WorldMeta {
  name: string;
  seed: number;
  createdAt: number;
}

export class GameClient {
  private sse: EventStream | null = null;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  readonly contextId: string;

  constructor() {
    this.contextId = getSession().contextId ?? "";
  }

  exec = <T = unknown>(method: string, args: Record<string, unknown>): Promise<T> =>
    getTransport().exec<T>(this.contextId, method, args);

  /**
   * "Me" as the contract sees it — the node's context identity, or an
   * account's delegated device key. `null` when there is none, which boot()
   * acts on; there is deliberately no cached fallback (see
   * `nodeTransport.resolveMyId`).
   */
  resolveIdentity(): Promise<string | null> {
    return getTransport().resolveMyId(this.contextId);
  }

  async fetchWorldMeta(): Promise<WorldMeta> {
    return this.exec<WorldMeta>("world_meta", {});
  }

  /**
   * `onReconnect` runs when the stream comes back after a drop (the node was
   * restarted, the machine slept). SseClient re-subscribes on its own, but
   * every event from the gap is lost, and blocks are only pulled on an event —
   * so without a re-read, edits made meanwhile never showed up.
   */
  subscribe(onEvent: (ev: GameEvent) => void, onReconnect?: () => void): void {
    const contextId = this.contextId;
    if (!contextId) return;
    const sse = getTransport().openEvents();
    if (!sse) return;
    this.sse = sse;
    // mero-js ≥7.1 widened the handler to context events OR group-membership
    // events; the latter carries a groupId and no contextId, and says nothing
    // about the world, so drop it here.
    sse.on("event", (raw: unknown) => {
      const evt = raw as SseEventData | GroupMembershipEventData | GroupMigrationEventData;
      if (!("contextId" in evt)) return;
      if (evt.contextId && evt.contextId !== contextId) return;
      for (const ev of decodeSseEvents(evt.data)) onEvent(ev);
    });
    // Most stream errors are transient: SseClient reconnects on its own and
    // polling covers the gap, so swallowing them is right.
    //
    // `AuthRevokedError` is the one that is not. From mero-js 19.14.1 (#166) a
    // revoked token family is recognised on the stream — it arrives as 403 +
    // `x-auth-error: token_revoked`, never 401 — and the client deliberately
    // STOPS reconnecting, because every retry re-sends the same dead
    // credential. So "it reconnects on its own" stops being true at exactly
    // this point, and swallowing it leaves the game silently frozen with no
    // way back. Nothing we hold is live; clear it and make the user log in.
    sse.on("error", (err: Error) => {
      if (err instanceof AuthRevokedError) {
        console.warn(`[sse] auth revoked (${err.reason}) — re-login required`);
        clearSession();
      }
    });
    // Every `connect` after the first is a reconnect. Deferred so the
    // re-subscribe SseClient sends right after `connect` lands first.
    let connectedOnce = false;
    sse.on("connect", () => {
      if (!connectedOnce) {
        connectedOnce = true;
        return;
      }
      if (this.resyncTimer) clearTimeout(this.resyncTimer);
      this.resyncTimer = setTimeout(() => {
        this.resyncTimer = null;
        onReconnect?.();
      }, RESYNC_DELAY_MS);
    });
    sse.connect().catch(() => {});
    sse.subscribe([contextId]).catch(() => {});
  }

  close(): void {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
    this.sse?.close();
    this.sse = null;
  }
}
