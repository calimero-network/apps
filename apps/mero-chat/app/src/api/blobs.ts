/**
 * Blobs of a conversation: files, images and avatars.
 *
 * In 1.0 a blob belongs to an app instance: the client uploads its bytes to the
 * app (`POST /apps/{app}/blobs`), passes the id (64 hex digits) to a method that
 * stores a `BlobRef`, and anyone who reaches the app downloads it. The host keeps
 * a blob while state refers to it. v1's per-context discovery across peers,
 * the base58 spelling and the node-local store are gone; every function here
 * takes the app (v1's context id) the blob belongs to.
 */
import { connection, getActiveApp } from "../calimero/connection";

/** How long the client waits for a blob read. */
export const BLOB_READ_TIMEOUT_MS = 35_000;

const HEX_32 = /^[0-9a-fA-F]{64}$/;

/** A blob id as the contract takes it: 64 lowercase hex digits, or `""`. */
export function toBlobIdHex(value: string | number[] | Uint8Array): string {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return bytes.length === 32 ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") : "";
  }
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/^0x/, "");
  return HEX_32.test(trimmed) ? trimmed.toLowerCase() : "";
}

export function isUsableBlobId(value: string | number[] | Uint8Array): boolean {
  return toBlobIdHex(value).length === 64;
}

export class BlobContextRequiredError extends Error {
  constructor(operation: string) {
    super(`${operation} needs the conversation the blob belongs to.`);
    this.name = "BlobContextRequiredError";
  }
}

function requireApp(app: string | undefined, operation: string): string {
  const id = (app || getActiveApp() || "").trim();
  if (!id) throw new BlobContextRequiredError(operation);
  return id;
}

export interface BlobUploadResult {
  blobId: string;
  size: number;
}

async function bytesOf(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

/** Uploads `data` to the conversation `app`; answers its hex id. */
export async function uploadBlob(
  data: Blob | ArrayBuffer | Uint8Array,
  app: string,
): Promise<BlobUploadResult> {
  const id = requireApp(app, "uploadBlob");
  const conn = connection();
  try {
    const res = await conn.client.uploadBlob(id, await bytesOf(data));
    const blobId = toBlobIdHex(res.id);
    if (!blobId) throw new Error(`The node returned a blob id this app cannot use: ${res.id}`);
    return { blobId, size: res.size };
  } finally {
    conn.after();
  }
}

/** The blob's bytes. */
export async function downloadBlob(blobId: string, app: string): Promise<Blob> {
  const id = requireApp(app, "downloadBlob");
  const hex = toBlobIdHex(blobId);
  if (!hex) throw new Error(`Not a usable blob id: ${blobId}`);
  const conn = connection();
  try {
    const bytes = await conn.client.downloadBlob(id, hex);
    return new Blob([bytes as BlobPart]);
  } finally {
    conn.after();
  }
}

/** Whether the conversation holds the blob, and its size. */
export async function blobInfo(
  blobId: string,
  app: string,
): Promise<{ found: boolean; info: { size: number } | null }> {
  const id = requireApp(app, "blobInfo");
  const hex = toBlobIdHex(blobId);
  if (!hex) return { found: false, info: null };
  try {
    const info = await connection().client.blobInfo(id, hex);
    return { found: true, info: { size: info.size } };
  } catch (e) {
    if (isNotFound(e)) return { found: false, info: null };
    throw e;
  }
}

/**
 * Deletes an upload nothing refers to (an attachment removed before sending).
 * Only its uploader or an org admin may; a refusal is ignored, since the host
 * drops an unreferenced blob after its idle expiry anyway.
 */
export async function deleteBlob(blobId: string, app?: string): Promise<void> {
  const hex = toBlobIdHex(blobId);
  if (!hex) return;
  try {
    await connection().client.deleteBlob(requireApp(app, "deleteBlob"), hex);
  } catch {
    /* expires on its own */
  }
}

/** A 404, however the transport surfaced it. */
export function isNotFound(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status === 404) return true;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return /\b404\b|not found/i.test(message);
}
