// GameClient: session + JSON-RPC + SSE subscription in one connect() call.

import { SseClient, type SseEventData } from "@calimero-network/mero-js";
import { getAccessToken, getSession } from "./session";
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

  /** my per-context identity: hash > node identities-owned > cached fallback */
  async resolveIdentity(): Promise<string | null> {
    const s = getSession();
    if (s.executorPublicKey) return s.executorPublicKey;
    const cacheKey = `mb-identity-${this.target.contextId}`;
    try {
      const res = await fetch(
        `${this.target.nodeUrl}/admin-api/contexts/${this.target.contextId}/identities-owned`,
        { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } },
      );
      const body = await res.json();
      const data = body?.data;
      const arr = Array.isArray(data) ? data : (data?.identities ?? data?.items ?? []);
      if (Array.isArray(arr) && arr.length > 0) {
        localStorage.setItem(cacheKey, String(arr[0]));
        return String(arr[0]);
      }
    } catch {
      /* node unreachable or context not joined here — fall through to cache */
    }
    return localStorage.getItem(cacheKey);
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
    this.sse.on("event", (evt: SseEventData) => {
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
