import { useEffect, useState } from "react";
import type { Audio } from "./generated/client";
import type { WorkspaceBlobs } from "./useWorkspace";

/**
 * A meeting's recording as a URL the `<audio>` element plays.
 *
 * A blob is named by the SHA-256 of its bytes, so a downloaded one is checked
 * against its id before it is played or kept, and a kept one never changes.
 * Recordings are kept in IndexedDB under `<appId>/<blobId>`, at most
 * {@link CACHE_CAP_BYTES} in all: the least recently played go first.
 * Every cache access may fail (private windows, a full disk); a failure only
 * costs a download.
 */

/** Recordings kept in this browser, in bytes. */
export const CACHE_CAP_BYTES = 250 * 1024 * 1024;

const DB_NAME = "sylence-audio";
const DB_VERSION = 2;
const STORE = "recordings";

interface Entry {
  blob: Blob;
  size: number;
  lastUsed: number;
}

export interface CacheRow {
  key: string;
  size: number;
  lastUsed: number;
}

/**
 * The keys to drop so the cache holds at most `cap` bytes, least recently
 * used first; `keep` (the entry just written) is never dropped.
 */
export function evictionPlan(rows: readonly CacheRow[], cap: number, keep?: string): string[] {
  let total = rows.reduce((n, r) => n + r.size, 0);
  const out: string[] = [];
  for (const r of [...rows].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (total <= cap) break;
    if (r.key === keep) continue;
    out.push(r.key);
    total -= r.size;
  }
  return out;
}

const keyOf = (appId: string, blobId: string) => `${appId}/${blobId}`;

/** The SHA-256 of `data` as 64 lowercase hex digits. */
export async function sha256Hex(data: ArrayBuffer | Blob): Promise<string> {
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
  // A copy in this realm: some runtimes refuse an ArrayBuffer made by another one (a test DOM).
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(new Uint8Array(bytes))));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1 kept ArrayBuffers by bare blob id; they are dropped, not migrated.
      if (db.objectStoreNames.contains("blobs")) db.deleteObjectStore("blobs");
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    /** Set once a blocked open was given up: a late success is closed, not leaked. */
    let gaveUp = false;
    req.onsuccess = () => {
      const db = req.result;
      if (gaveUp) {
        db.close();
        return;
      }
      // Another tab upgrading the store: let it, and open again next time.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    // A tab with an older version holds the store open: no cache this time, rather than no playback.
    req.onblocked = () => {
      gaveUp = true;
      dbPromise = null;
      reject(new Error("the recording cache is held by another tab"));
    };
  });
  return dbPromise;
}

/** How long playback waits for the cache before it downloads instead. */
export const CACHE_WAIT_MS = 2_000;

/** `p`, or `fallback` when it has not settled within `ms`. */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

function done(req: IDBRequest | IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    if ("oncomplete" in req) {
      req.oncomplete = () => resolve();
      req.onerror = () => reject(req.error);
      req.onabort = () => reject(req.error);
    } else {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }
  });
}

async function cached(appId: string, blobId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const key = keyOf(appId, blobId);
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    await done(req);
    const entry = req.result as Entry | undefined;
    if (!entry?.blob) return null;
    store.put({ ...entry, lastUsed: Date.now() } satisfies Entry, key);
    await done(tx);
    return entry.blob;
  } catch {
    return null;
  }
}

async function rows(store: IDBObjectStore): Promise<CacheRow[]> {
  const out: CacheRow[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const e = c.value as Entry;
      out.push({ key: String(c.key), size: e.size ?? 0, lastUsed: e.lastUsed ?? 0 });
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

/**
 * Keeps `data`, the blob `blobId` of workspace `appId`, then drops the least
 * recently played recordings past the cap. One larger than the cap is not kept.
 */
/** Bumped by every forget: a write started before one is dropped, not landed after it. */
let generation = 0;

export async function rememberRecording(appId: string, blobId: string, data: Blob): Promise<void> {
  if (data.size > CACHE_CAP_BYTES) return;
  const started = generation;
  try {
    const db = await openDb();
    if (!db || started !== generation) return;
    const key = keyOf(appId, blobId);
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({ blob: data, size: data.size, lastUsed: Date.now() } satisfies Entry, key);
    for (const k of evictionPlan(await rows(store), CACHE_CAP_BYTES, key)) store.delete(k);
    await done(tx);
  } catch {
    // A full or blocked store only costs a download next time.
  }
}

/** Drops one kept recording (its meeting was deleted, or its audio removed). */
export async function forgetRecording(appId: string, blobId: string): Promise<void> {
  generation += 1;
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(keyOf(appId, blobId));
    await done(tx);
  } catch {
    // ignore
  }
}

/** Drops the kept recordings of workspace `appId` whose blob id is not in `keep` (no meeting names them any more). */
export async function pruneRecordings(appId: string, keep: ReadonlySet<string>): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const prefix = `${appId}/`;
    for (const r of await rows(store)) {
      if (r.key.startsWith(prefix) && !keep.has(r.key.slice(prefix.length))) store.delete(r.key);
    }
    await done(tx);
  } catch {
    // ignore
  }
}

/** Drops every kept recording of workspace `appId`, or of every workspace (signing out). */
export async function forgetWorkspaceRecordings(appId?: string): Promise<void> {
  generation += 1;
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (appId === undefined) store.clear();
    else for (const r of await rows(store)) if (r.key.startsWith(`${appId}/`)) store.delete(r.key);
    await done(tx);
  } catch {
    // ignore
  }
}

/**
 * A meeting's recording as a Blob: the copy kept in this browser if there is
 * one, else downloaded from the workspace and checked against its id (and
 * then kept). The player and "Download recording" both read it this way.
 */
export async function recordingBlob(blobs: WorkspaceBlobs, audio: Pick<Audio, "blob" | "mime">): Promise<Blob> {
  const { blob: blobId, mime } = audio;
  const kept = await within(cached(blobs.appId, blobId), CACHE_WAIT_MS, null);
  if (kept) return mime && kept.type !== mime ? kept.slice(0, kept.size, mime) : kept;
  const data = await blobs.download(blobId);
  if ((await sha256Hex(data)) !== blobId) throw new Error("the recording did not match its id");
  const blob = new Blob([data], { type: mime || "audio/mpeg" });
  void rememberRecording(blobs.appId, blobId, blob);
  return blob;
}

export interface RecordingState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

/** The recording's object URL, once read and checked; `null` audio gives nothing. */
export function useRecording(blobs: WorkspaceBlobs, audio: Audio | null | undefined): RecordingState {
  const blobId = audio?.blob ?? null;
  const mime = audio?.mime ?? "";
  const appId = blobs.appId;
  const [state, setState] = useState<RecordingState>({ url: null, loading: false, error: null });
  useEffect(() => {
    if (!blobId) {
      setState((old) => (old.url === null && !old.loading && old.error === null ? old : { url: null, loading: false, error: null }));
      return;
    }
    let live = true;
    let url: string | null = null;
    setState({ url: null, loading: true, error: null });
    void (async () => {
      try {
        const blob = await recordingBlob(blobs, { blob: blobId, mime });
        if (!live) return;
        url = URL.createObjectURL(blob);
        setState({ url, loading: false, error: null });
      } catch (e) {
        if (live) setState({ url: null, loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blobs, appId, blobId, mime]);
  return state;
}
