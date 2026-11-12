import { useMemo } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";

import { getCachedBlob, setCachedBlob } from "../utils/blobCache";
import { pixartClient, type MeroPixartClient } from "./pixart";
import { useSignedIn } from "./sessionContext";

// ── The app's one way to talk to Calimero ───────────────────────────────────
//
// The screens ask `useApi()` and never the client directly, so they kept the
// shape v1 gave them:
//   * contract calls → `app(contextId)`: the document's `MeroPixartClient`
//                      (src/generated, from the ABI), refusals in v1's words.
//   * blobs          → the document's own blobs: `client.uploadBlob(app, …)` /
//                      `client.downloadBlob(app, id)`. v1 announced each blob to
//                      the context; an upload to the app is the app's already.
//   * identity       → the signed-in account, which is what the contract keys
//                      members, roles, authorship and cursors by.

export interface Api {
  client: CalimeroClient;
  /** The signed-in account. */
  accountId: string;
  /** The contract of the document `contextId`, through its generated client. */
  app(contextId: string): MeroPixartClient;
  /**
   * Upload a blob to the document `contextId`. `blobId` is the 64-hex id the
   * contract stores (and the base58 form v1 stored is not accepted).
   */
  uploadBlob(data: ArrayBuffer | Uint8Array, contextId: string): Promise<{ blobId: string }>;
  /** Read one of the document's blobs, cached in IndexedDB (blobs never change). */
  getBlob(blobId: string, contextId: string): Promise<ArrayBuffer>;
}

/** A copy of `bytes` in an ArrayBuffer of its own. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

export function useApi(): Api {
  const { client, accountId, after } = useSignedIn();

  return useMemo<Api>(() => {
    const app = (contextId: string) => pixartClient(client, contextId, after);

    async function uploadBlob(data: ArrayBuffer | Uint8Array, contextId: string): Promise<{ blobId: string }> {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      try {
        const res = await client.apps.blobUpload({
          app: contextId,
          body: bytes,
          contentType: "application/octet-stream",
        });
        return { blobId: res.id };
      } finally {
        after();
      }
    }

    async function getBlob(blobId: string, contextId: string): Promise<ArrayBuffer> {
      const cached = await getCachedBlob(blobId);
      if (cached) return cached;
      try {
        const buf = ownBuffer(await client.downloadBlob(contextId, blobId));
        void setCachedBlob(blobId, buf);
        return buf;
      } finally {
        after();
      }
    }

    return { client, accountId, app, uploadBlob, getBlob };
  }, [client, accountId, after]);
}
