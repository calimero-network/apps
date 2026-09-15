// GameClient: session + JSON-RPC + SSE subscription in one connect() call.

import {
  SseClient,
  type GroupMembershipEventData,
  type GroupMigrationEventData,
  type SseEventData,
} from "@calimero-network/mero-js";
import { getAccessToken, getSession } from "./session";
import { ownedContextIdentity } from "./admin";
import { rpcExecute, RpcTarget } from "./rpc";
import { decodeSseEvents, GameEvent } from "./events";

export interface WorldMeta {
  name: string;
  seed: number;
  createdAt: number;
}

export class GameClient {
  private sse: SseClient | null = null;
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

  subscribe(onEvent: (ev: GameEvent) => void): void {
    const s = getSession();
    if (!s.nodeUrl || !s.contextId) return;
    const contextId = s.contextId;
    this.sse = new SseClient({
      baseUrl: s.nodeUrl,
      getAuthToken: async () => getAccessToken() ?? "",
      reconnectDelayMs: 8000,
    });
    // mero-js ≥7.1 widened the handler to context events OR group-membership
    // events; the latter carries a groupId and no contextId, and says nothing
    // about the world, so drop it here.
    this.sse.on("event", (evt: SseEventData | GroupMembershipEventData | GroupMigrationEventData) => {
      if (!("contextId" in evt)) return;
      if (evt.contextId && evt.contextId !== contextId) return;
      for (const ev of decodeSseEvents(evt.data)) onEvent(ev);
    });
    this.sse.on("error", () => {
      /* SseClient reconnects on its own; polling covers the gap */
    });
    this.sse.connect().catch(() => {});
    this.sse.subscribe([contextId]).catch(() => {});
  }

  close(): void {
    this.sse?.close();
    this.sse = null;
  }
}
