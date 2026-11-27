/**
 * A finished call's recording, on its way to the workspace. The offscreen page
 * records the call and the microphone mixed into one compressed track (Opus in
 * WebM, ~24 kbit/s: an hour is ~11 MB). Messages between extension pages carry
 * JSON, not a file, so it waits here, in the extension's own IndexedDB, until
 * the service worker uploads it as a blob of the workspace and attaches it to
 * the meeting, as an uploaded recording is. One at a time: a new call replaces
 * one never sent.
 */

export interface CallAudio {
  blob: Blob;
  /** As the contract keeps it: no codec parameters ("audio/webm"). */
  mime: string;
  durationMs: number;
}

/** The node's largest blob (47.25 MiB): a longer recording is not kept. */
export const MAX_CALL_AUDIO_BYTES = 49_545_216;

/** The bitrate the recorder asks for: speech stays clear, three hours stay under one blob. */
export const CALL_AUDIO_BITRATE = 24_000;

const DB = "sylence-call-audio";
const STORE = "audio";
const KEY = "last";

function open(idb: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("could not open the audio store"));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, idb?: IDBFactory): Promise<T> {
  return open(idb).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("the audio store failed"));
        };
      }),
  );
}

/** Keeps the call's recording for the service worker to send. */
export async function keepCallAudio(audio: CallAudio, idb?: IDBFactory): Promise<void> {
  await run("readwrite", (s) => s.put(audio, KEY), idb);
}

/** Takes the kept recording (and forgets it), or `null` when there is none. */
export async function takeCallAudio(idb?: IDBFactory): Promise<CallAudio | null> {
  const audio = (await run<CallAudio | undefined>("readonly", (s) => s.get(KEY) as IDBRequest<CallAudio | undefined>, idb)) ?? null;
  await run("readwrite", (s) => s.delete(KEY), idb);
  return audio && audio.blob ? audio : null;
}

/** The recorder's type, as the contract keeps it: "audio/webm;codecs=opus" → "audio/webm". */
export function plainMime(type: string): string {
  return (type.split(";")[0] ?? "").trim().toLowerCase() || "audio/webm";
}

/** Why a recording is not kept for playback, or `null` when it is. */
export function unkeptCallAudio(audio: CallAudio | null): string | null {
  if (!audio || audio.blob.size === 0) return "No audio was recorded.";
  if (audio.blob.size > MAX_CALL_AUDIO_BYTES) return "The recording is longer than one workspace file holds, so only the transcript was saved.";
  return null;
}

/** A recording's bytes (`Blob.arrayBuffer`, or a FileReader where a Blob has none). */
export async function callAudioBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("could not read the recording"));
    r.readAsArrayBuffer(blob);
  });
}
