/**
 * The one place the repository database is opened.
 *
 * IndexedDB versions a whole database, not a store. Two modules opening
 * "mero-chat-repositories" at different versions is not a merge of their
 * schemas — the lower one fails to open outright once the higher has run, and
 * the higher blocks while the lower holds a connection. Both then fall back to
 * "no persistence" quietly, which looks exactly like a cold cache and is very
 * hard to see. So the version and the full store list live here, and every
 * store this app has is created in one upgrade.
 *
 * Adding a store means bumping `DB_VERSION` and adding it to `upgrade`.
 */

const DB_NAME = "mero-chat-repositories";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * The shared connection, or `null` where IndexedDB is unavailable or blocked.
 *
 * Never rejects: storage being disabled, full, or held by another tab is not a
 * reason to fail a read the node can still answer.
 */
export function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // Another tab holds an older version open. Proceed without persistence
      // rather than hang the caller until it closes.
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains("crypto")) {
    db.createObjectStore("crypto", { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains("names")) {
    db.createObjectStore("names", { keyPath: "key" });
  }
  if (!db.objectStoreNames.contains("messages")) {
    const messages = db.createObjectStore("messages", { keyPath: "pk" });
    // Range reads by position within a channel: the access pattern the store
    // exists for, and what makes scrolling up a cursor walk rather than a scan.
    messages.createIndex("byContextIndex", ["contextId", "index"]);
  }
  if (!db.objectStoreNames.contains("cursors")) {
    db.createObjectStore("cursors", { keyPath: "contextId" });
  }
}

/**
 * Test seam: close and forget the cached connection.
 *
 * Closing matters as much as forgetting — an open connection blocks both
 * `deleteDatabase` and any version upgrade, so a test that only dropped the
 * reference would hang the next one rather than fail it.
 */
export async function resetDbForTests(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  const db = await pending;
  db?.close();
}
