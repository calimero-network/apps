// GameClient: contract calls + the event stream for the current world, over
// whichever transport the session rides (see transport.ts). Nothing here
// knows whether it is a node or an account.

import {
  AuthRevokedError,
  type GroupMembershipEventData,
  type GroupMigrationEventData,
  type SseClient,
  type SseEventData,
} from "@calimero-network/mero-js";
import { clearSession, getSession } from "./session";
import { getTransport, type Transport } from "./transport";
import { bindExec, type Exec } from "./rpc";
import { decodeSseEvents, GameEvent } from "./events";

/** How long after a reconnect to wait before re-reading the world. */
const RESYNC_DELAY_MS = 500;

export interface WorldMeta {
  name: string;
  seed: number;
  createdAt: number;
}

export class GameClient {
  private sse: SseClient | null = null;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  readonly contextId: string;
  private transport: Promise<Transport>;

  constructor(transport: Promise<Transport> = getTransport()) {
    this.contextId = getSession().contextId ?? "";
    this.transport = transport;
  }

  /** `exec(method, args)` bound to this world — what SyncEngine drives. */
  exec: Exec = async <T = unknown>(method: string, args: Record<string, unknown>): Promise<T> => {
    const t = await this.transport;
    return bindExec(t.rpc, this.contextId)<T>(method, args);
  };

  /**
   * My identity in this world, as the contract will render it: the hash's,
   * else what the node reports owning; the device signing key on an account.
   *
   * There is deliberately no cached fallback. This used to end in
   * `localStorage.getItem(cacheKey)`, which meant a node that owns no identity
   * for the context still produced one — so the app rendered as if it had
   * joined and every contract call then failed with "No owned identity found
   * for this context". A cache that answers when the node cannot is a lie
   * about membership; `null` is the honest answer and boot() acts on it.
   */
  async resolveIdentity(): Promise<string | null> {
    const t = await this.transport;
    return t.myId(this.contextId).catch(() => null);
  }

  async fetchWorldMeta(): Promise<WorldMeta> {
    return this.exec<WorldMeta>("world_meta", {});
  }

  /**
   * `onReconnect` runs when the stream comes back after a drop (the node was
   * restarted, the machine slept). SseClient re-subscribes on its own, but
   * every event from the gap is lost, and tiles are only pulled on an event —
   * so without a re-read, edits made meanwhile never showed up.
   *
   * Resolves once the stream object exists (or never will: an account with
   * no relay has nothing to listen to, and polling covers it).
   */
  async subscribe(onEvent: (ev: GameEvent) => void, onReconnect?: () => void): Promise<void> {
    const contextId = this.contextId;
    if (!contextId) return;
    const t = await this.transport;
    const sse = t.events();
    if (!sse) return;
    this.sse = sse;
    // mero-js 7 widened the "event" stream to a union: group-membership events
    // ride the same channel, keyed by groupId instead of contextId. We only ever
    // subscribe to a context, so one of those is never ours — and the `in` check
    // is what lets the compiler agree before we read contextId.
    sse.on("event", (evt: SseEventData | GroupMembershipEventData | GroupMigrationEventData) => {
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
    // (A node-token matter: an account's stream is a device-cert session.)
    sse.on("error", (err: Error) => {
      if (t.kind === "node" && err instanceof AuthRevokedError) {
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
