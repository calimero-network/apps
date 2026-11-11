import type { CalimeroClient } from "@calimero-network/mero-js";
import { MAX_BLOB_BYTES } from "./model";
import { type ClientRoutes } from "@calimero-apps/connect";

/**
 * Blobs: where meshes and textures actually live.
 *
 * Each is one of the scene's own blobs (`POST /apps/{app}/blobs`), named by the
 * SHA-256 of its bytes, so a downloaded one never changes: it is cached by id
 * in IndexedDB (and in memory for the session) and never fetched twice. The
 * contract stores the id as a typed reference, which is what keeps the blob on
 * the cluster for as long as a mesh, a texture or a history row names it.
 *
 * One blob is at most {@link MAX_BLOB_BYTES} (47.25 MiB): it reaches the other
 * nodes inside one sealed request. A larger one is refused here, before the
 * upload, with the reason; see the README ("Large models").
 */

export interface BlobTransport {
  upload(data: Uint8Array, appId: string): Promise<{ blobId: string; size: number }>;
  download(blobId: string, appId: string): Promise<ArrayBuffer>;
}

/** Why a blob is not uploaded: too large for one sealed request. */
export function tooLarge(bytes: number): string | null {
  if (bytes <= MAX_BLOB_BYTES) return null;
  const mib = (n: number) => (n / (1024 * 1024)).toFixed(2);
  return `This is ${mib(bytes)} MiB once encoded; one mesh or texture is at most ${mib(MAX_BLOB_BYTES)} MiB. Decimate it, split it into several objects, or use a smaller image.`;
}

/** The app's blobs through a signed-in `CalimeroClient`. */
export function clientTransport(
  client: Pick<CalimeroClient, "downloadBlob"> & ClientRoutes<{ apps: "blobUpload" }>,
  after: () => void = () => {},
): BlobTransport {
  return {
    async upload(data, appId) {
      const refusal = tooLarge(data.byteLength);
      if (refusal) throw new Error(refusal);
      try {
        const res = await client.apps.blobUpload({ app: appId, body: data, contentType: "application/octet-stream" });
        // The contract takes the hex id (64 lowercase digits), not the base58 one.
        if (!res?.id) throw new Error("the node accepted the upload but returned no blob id");
        return { blobId: res.id.toLowerCase(), size: res.size ?? data.byteLength };
      } finally {
        after();
      }
    },
    async download(blobId, appId) {
      try {
        const bytes = await client.downloadBlob(appId, blobId);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      } finally {
        after();
      }
    },
  };
}

const DB_NAME = "mero-models-blobs";
const STORE = "blobs";
/** In-memory entries kept for the session, by count; the rest stay in IndexedDB. */
const MEMORY_ENTRIES = 64;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

async function idbGet(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(id: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(data, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // A full or blocked cache only costs a re-download.
  }
}

export class BlobStore {
  private memory = new Map<string, ArrayBuffer>();
  private inflight = new Map<string, Promise<ArrayBuffer>>();

  constructor(
    private transport: BlobTransport,
    private appId: string,
    private persistent = true,
  ) {}

  async put(data: Uint8Array): Promise<{ blobId: string; size: number }> {
    const res = await this.transport.upload(data, this.appId);
    // The bytes are already here; no reason to download them again.
    const copy = data.slice().buffer as ArrayBuffer;
    this.remember(res.blobId, copy);
    if (this.persistent) void idbPut(res.blobId, copy);
    return res;
  }

  get(blobId: string): Promise<ArrayBuffer> {
    const hit = this.memory.get(blobId);
    if (hit) {
      this.remember(blobId, hit);
      return Promise.resolve(hit);
    }
    const pending = this.inflight.get(blobId);
    if (pending) return pending;
    const p = (async () => {
      const cached = this.persistent ? await idbGet(blobId) : null;
      const data = cached ?? (await this.transport.download(blobId, this.appId));
      if (!cached && this.persistent) void idbPut(blobId, data);
      this.remember(blobId, data);
      return data;
    })().finally(() => this.inflight.delete(blobId));
    this.inflight.set(blobId, p);
    return p;
  }

  private remember(blobId: string, data: ArrayBuffer): void {
    this.memory.delete(blobId);
    this.memory.set(blobId, data);
    while (this.memory.size > MEMORY_ENTRIES) this.memory.delete(this.memory.keys().next().value!);
  }
}
