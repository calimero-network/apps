import { openDb } from "./db";
import type { PersistentLayer, Resolved } from "./types";

/**
 * IndexedDB-backed durable layer.
 *
 * The single persistence engine for repositories. It is asynchronous, which
 * costs a brief placeholder on first paint after a reload, and buys everything
 * that matters afterwards: capacity measured in hundreds of megabytes rather
 * than five, writes that do not stall the main thread, real range queries for
 * paginated data, native Blob storage for attachments, and the ability to hold
 * a non-extractable `CryptoKey` if a repository ever persists something that
 * needs encrypting at rest.
 *
 * One store per repository, keyed by name, so repositories cannot evict or
 * corrupt each other's entries.
 *
 * Every operation is best-effort. Storage can be disabled, full, or blocked in
 * private browsing; none of that is a reason to fail a read the source can
 * still answer, so failures resolve quietly rather than reject.
 */
export class IndexedDbPersistence<V> implements PersistentLayer<V> {
  constructor(
    /** Object store name, created by `openDb`'s upgrade. */
    private readonly store: "names",
    /** Cap on retained entries; oldest fetched are dropped first. */
    private readonly maxEntries = 5000,
  ) {}

  async read(): Promise<Map<string, Resolved<V>>> {
    const db = await openDb();
    if (!db) return new Map();

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.store, "readonly");
        const req = tx.objectStore(this.store).getAll();
        req.onsuccess = () => {
          const out = new Map<string, Resolved<V>>();
          for (const row of (req.result ?? []) as StoredRow<V>[]) {
            if (row && typeof row.key === "string") {
              out.set(row.key, row.entry);
            }
          }
          resolve(out);
        };
        req.onerror = () => resolve(new Map());
      } catch {
        resolve(new Map());
      }
    });
  }

  async write(entries: Map<string, Resolved<V>>): Promise<void> {
    const db = await openDb();
    if (!db) return;

    let list = [...entries.entries()];
    if (list.length > this.maxEntries) {
      list = list
        .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
        .slice(0, this.maxEntries);
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.store, "readwrite");
        const os = tx.objectStore(this.store);
        // Replace wholesale: the caller owns the full set, and reconciling
        // deletions key-by-key would cost more than rewriting a small store.
        os.clear();
        for (const [key, entry] of list) os.put({ key, entry } as StoredRow<V>);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clear(): Promise<void> {
    const db = await openDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.store, "readwrite");
        tx.objectStore(this.store).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

}

interface StoredRow<V> {
  key: string;
  entry: Resolved<V>;
}
