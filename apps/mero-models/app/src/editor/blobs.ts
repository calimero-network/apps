/**
 * Blobs: where meshes and textures actually live.
 *
 * Uploads carry the context id, so the node announces the blob to the
 * context's members at once; reads carry it too, so a blob only a peer holds
 * is discovered and fetched instead of 404ing locally. Blobs are
 * content-addressed, so a downloaded one never changes: it is cached by id in
 * IndexedDB (and in memory for the session) and never fetched twice.
 */

export interface BlobTransport {
  upload(data: Uint8Array, contextId: string): Promise<{ blobId: string; size: number }>;
  download(blobId: string, contextId: string): Promise<ArrayBuffer>;
}

/** The node's admin API, as mero-js exposes it on `useMero().admin`. */
export interface AdminBlobApi {
  uploadBlob(req: { data: Uint8Array | ArrayBuffer | Blob; contextId?: string }): Promise<{ blobId: string; size: number }>;
  getBlob(blobId: string, options?: { contextId?: string }): Promise<ArrayBuffer>;
}

export function adminTransport(admin: AdminBlobApi): BlobTransport {
  return {
    async upload(data, contextId) {
      const res = await admin.uploadBlob({ data, contextId });
      if (!res?.blobId) throw new Error("the node accepted the upload but returned no blob id");
      return { blobId: res.blobId, size: res.size ?? data.byteLength };
    },
    download: (blobId, contextId) => admin.getBlob(blobId, { contextId }),
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
    private contextId: string,
    private persistent = true,
  ) {}

  async put(data: Uint8Array): Promise<{ blobId: string; size: number }> {
    const res = await this.transport.upload(data, this.contextId);
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
      const data = cached ?? (await this.transport.download(blobId, this.contextId));
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
