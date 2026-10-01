// GameClient: session + JSON-RPC + SSE subscription in one connect() call.

import {
  AuthRevokedError,
  SseClient,
  type GroupMembershipEventData,
  type GroupMigrationEventData,
  type SseEventData,
} from "@calimero-network/mero-js";
import { clearSession, getAccessToken, getSession } from "./session";
import { ownedContextIdentity } from "./admin";
import { rpcExecute, RpcTarget } from "./rpc";
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
  target: RpcTarget;

  constructor() {
    const s = getSession();
    this.target = {
      nodeUrl: s.nodeUrl ?? "",
      contextId: s.contextId ?? "",
      getToken: getAccessToken,
      executorPublicKey: s.executorPublicKey,
    };
  }

  exec = <T = unknown>(method: string, args: Record<string, unknown>): Promise<T> =>
    rpcExecute<T>(this.target, method, args);

  /**
   * My per-context identity: the hash, else what the NODE reports owning.
   *
   * There is deliberately no cached fallback. This used to end in
   * `localStorage.getItem(cacheKey)`, which meant a node that owns no identity
   * for the context still produced one — so the app rendered as if it had
   * joined and every contract call then failed with "No owned identity found
   * for this context". A cache that answers when the node cannot is not a
   * fallback, it is a lie about membership; `null` is the honest answer and
   * boot() acts on it.
   */
  async resolveIdentity(): Promise<string | null> {
    const s = getSession();
    if (s.executorPublicKey) return s.executorPublicKey;
    const owned = await ownedContextIdentity(this.target.contextId).catch(() => "");
    return owned || null;
  }

  async fetchWorldMeta(): Promise<WorldMeta> {
    return this.exec<WorldMeta>("world_meta", {});
  }

  /**
   * `onReconnect` runs when the stream comes back after a drop (the node was
   * restarted, the machine slept). SseClient re-subscribes on its own, but
   * every event from the gap is lost, and tiles are only pulled on an event —
   * so without a re-read, edits made meanwhile never showed up.
   */
  subscribe(onEvent: (ev: GameEvent) => void, onReconnect?: () => void): void {
    const s = getSession();
    if (!s.nodeUrl || !s.contextId) return;
    const contextId = s.contextId;
    this.sse = new SseClient({
      baseUrl: s.nodeUrl,
      getAuthToken: async () => getAccessToken() ?? "",
      reconnectDelayMs: 8000,
    });
    // mero-js 7 widened the "event" stream to a union: group-membership events
    // ride the same channel, keyed by groupId instead of contextId. We only ever
    // subscribe to a context, so one of those is never ours — and the `in` check
    // is what lets the compiler agree before we read contextId.
    this.sse.on("event", (evt: SseEventData | GroupMembershipEventData | GroupMigrationEventData) => {
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
    this.sse.on("error", (err: Error) => {
      if (err instanceof AuthRevokedError) {
        console.warn(`[sse] auth revoked (${err.reason}) — re-login required`);
        clearSession();
      }
    });
    // Every `connect` after the first is a reconnect. Deferred so the
    // re-subscribe SseClient sends right after `connect` lands first.
    let connectedOnce = false;
    this.sse.on("connect", () => {
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
    this.sse.connect().catch(() => {});
    this.sse.subscribe([contextId]).catch(() => {});
  }

  close(): void {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
    this.sse?.close();
    this.sse = null;
  }
}
