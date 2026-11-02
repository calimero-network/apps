import { useMemo } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";

import { useSignedIn } from "../sessionContext";
import { getCachedBlob, setCachedBlob } from "../utils/blobCache";
import { PixartClient } from "./pixart";
import type { TileDeps } from "./tiles";

// ── The app's one way to talk to Calimero ───────────────────────────────────
//
// v1 had three routes here (the node's JSON-RPC or the relay's intents for
// contract calls, the session-aware admin client for blobs and governance, the
// node identity for "who am I"). On Calimero 1.0 there is one client,
// mero-js's `CalimeroClient`, signed in with a passkey:
//
//   * contract calls → `pixart.call(app, "get_layers", {})` (api/pixart.ts),
//                      which keeps v1's names and answers for the screens;
//   * blobs          → `client.uploadBlob(app, bytes)` / `downloadBlob(app, id)`,
//                      per app instance; content-addressed, so cached forever;
//   * identity       → the session's `accountId`, which is what the contract
//                      keys members, roles and authorship by;
//   * teams          → organizations (api/teams.ts).

export interface Api extends TileDeps {
  /** The signed-in account: what the contract names members by. */
  accountId: string;
  client: CalimeroClient;
  pixart: PixartClient;
  /** A v1-style contract call (snake_case names fine), its answer in the screens' shape. */
  call<T>(app: string, method: string, args?: Record<string, unknown>): Promise<T>;
  /** Uploads a blob for `app`; `blobId` is its 64-hex id (what the contract takes). */
  uploadBlob(data: ArrayBuffer | Uint8Array, app: string): Promise<{ blobId: string }>;
  /** One of `app`'s blobs, cached in IndexedDB (a blob id names its content). */
  getBlob(blobId: string, app: string): Promise<ArrayBuffer>;
}

/** Copies `data` into a fresh `ArrayBuffer`, as `downloadBlob`'s view may not own its buffer. */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(data.byteLength);
  new Uint8Array(out).set(data);
  return out;
}

export function makeApi(client: CalimeroClient, accountId: string, after: () => void): Api {
  const pixart = new PixartClient(client, after);
  return {
    accountId,
    client,
    pixart,
    call: (app, method, args = {}) => pixart.call(app, method, args),
    async uploadBlob(data, app) {
      try {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const res = await client.uploadBlob(app, bytes);
        return { blobId: res.id };
      } finally {
        after();
      }
    },
    async getBlob(blobId, app) {
      const cached = await getCachedBlob(blobId);
      if (cached) return cached;
      try {
        const buf = toArrayBuffer(await client.downloadBlob(app, blobId));
        void setCachedBlob(blobId, buf);
        return buf;
      } finally {
        after();
      }
    },
  };
}

/** The API of the signed-in session. Stable for the life of the session. */
export function useApi(): Api {
  const { client, accountId, after } = useSignedIn();
  return useMemo(() => makeApi(client, accountId, after), [client, accountId, after]);
}
