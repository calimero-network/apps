/**
 * Encryption at rest for anything a repository persists.
 *
 * # What this protects, and what it does not
 *
 * The key is generated with `extractable: false` and stored in IndexedDB, which
 * can hold a live `CryptoKey`. Script can *use* it to decrypt; it cannot read
 * the key material out, and neither can anything reading the database file.
 *
 * - **Protects:** the disk. A stolen laptop, a device backup, another OS user,
 *   a browser profile copied off the machine — all see ciphertext and a key
 *   object they cannot export.
 * - **Does NOT protect:** the page. Script running on this origin — an XSS, a
 *   compromised dependency — can call `decrypt` exactly as the app does. No
 *   browser storage defends against that, and claiming otherwise would be worse
 *   than not encrypting, because it invites storing things that should not be
 *   stored.
 *
 * That distinction is the whole reason this exists: it makes persisting
 * conversation history defensible, not private-against-everything.
 */

import { openDb } from "./db";

const KEY_STORE = "crypto";
const KEY_ID = "at-rest-v1";
const IV_BYTES = 12;

let keyPromise: Promise<CryptoKey | null> | null = null;

/**
 * The at-rest key, created on first use and reused thereafter.
 *
 * Returns `null` where WebCrypto or IndexedDB is unavailable — a repository
 * then declines to persist rather than falling back to plaintext, because
 * silently writing cleartext when encryption was requested is the failure this
 * whole module exists to prevent.
 */
export function atRestKey(): Promise<CryptoKey | null> {
  if (keyPromise) return keyPromise;

  keyPromise = (async () => {
    try {
      if (!globalThis.crypto?.subtle) return null;

      const db = await openDb();
      if (!db) return null;

      const existing = await readKey(db);
      if (existing) return existing;

      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        // Non-extractable: the point of storing it here rather than in a
        // string somewhere. `exportKey` on this will throw.
        false,
        ["encrypt", "decrypt"],
      );
      await writeKey(db, key);
      return key;
    } catch {
      return null;
    }
  })();

  return keyPromise;
}

export interface Sealed {
  iv: number[];
  data: ArrayBuffer;
}

/** Encrypt a JSON-serialisable value. Returns `null` if no key is available. */
export async function seal(value: unknown): Promise<Sealed | null> {
  const key = await atRestKey();
  if (!key) return null;
  try {
    // A fresh IV per record: AES-GCM loses its integrity guarantee outright if
    // an IV is reused under the same key, so this must never be hoisted or
    // cached alongside the key.
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return { iv: [...iv], data };
  } catch {
    return null;
  }
}

/** Decrypt a sealed value, or `undefined` if it cannot be read. */
export async function unseal<T>(sealed: Sealed | undefined): Promise<T | undefined> {
  if (!sealed) return undefined;
  const key = await atRestKey();
  if (!key) return undefined;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(sealed.iv) },
      key,
      sealed.data,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    // Wrong key (the store was cleared and the key regenerated) or tampering.
    // Either way the record is unreadable and is treated as absent — the node
    // is still authoritative and can supply it again.
    return undefined;
  }
}

/**
 * Drop the key, making every sealed record permanently unreadable.
 *
 * The logout path: cheaper and more complete than deleting records one by one,
 * because it invalidates anything missed.
 */
export async function destroyAtRestKey(): Promise<void> {
  keyPromise = null;
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(KEY_STORE, "readwrite");
      tx.objectStore(KEY_STORE).delete(KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Best effort.
  }
}


function readKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(KEY_ID);
      req.onsuccess = () => resolve((req.result?.key as CryptoKey) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(KEY_STORE, "readwrite");
      tx.objectStore(KEY_STORE).put({ id: KEY_ID, key });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
