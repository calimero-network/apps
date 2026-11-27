import { useEffect, useState } from "react";
import type { Audio } from "./generated/client";
import type { WorkspaceBlobs } from "./useWorkspace";

/**
 * A meeting's recording as a URL the `<audio>` element plays. The blob is
 * named by the SHA-256 of its bytes, so a downloaded one never changes: it is
 * kept in IndexedDB by id and read from there next time.
 */

const DB_NAME = "sylence-audio";
const STORE = "blobs";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function cached(id: string): Promise<ArrayBuffer | null> {
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

/** Keeps `data` under `id`; a full or blocked store only costs a download next time. */
export async function rememberRecording(id: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(data, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

export interface RecordingState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

/** The recording's object URL, once read; `null` audio gives nothing. */
export function useRecording(blobs: WorkspaceBlobs, audio: Audio | null | undefined): RecordingState {
  const blobId = audio?.blob ?? null;
  const mime = audio?.mime ?? "";
  const [state, setState] = useState<RecordingState>({ url: null, loading: false, error: null });
  useEffect(() => {
    if (!blobId) {
      setState({ url: null, loading: false, error: null });
      return;
    }
    let live = true;
    let url: string | null = null;
    setState({ url: null, loading: true, error: null });
    void (async () => {
      try {
        let data = await cached(blobId);
        if (!data) {
          data = await blobs.download(blobId);
          void rememberRecording(blobId, data);
        }
        if (!live) return;
        url = URL.createObjectURL(new Blob([data], { type: mime || "audio/mpeg" }));
        setState({ url, loading: false, error: null });
      } catch (e) {
        if (live) setState({ url: null, loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blobs, blobId, mime]);
  return state;
}
