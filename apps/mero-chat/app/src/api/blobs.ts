// Attachments, inline images and avatars, as blobs of the conversation's app
// instance.
//
// On Calimero 1.0 a blob belongs to an app: `POST /apps/{app}/blobs` stores the
// bytes on a majority of the cluster and marks them as that app's, and anyone
// who reaches the app downloads them with `GET /apps/{app}/blobs/{id}`. The
// contract keeps only the id (64 lowercase hex characters, the SHA-256), as v1
// did. There is no discovery and no announce: every node of the cluster holds
// what the app marks.
//
// Blobs for component apps arrived in core#4815 (1.0.0-rc.11), the runtime
// this app requires (`min-runtime-version` in logic/Cargo.toml), so every node
// that runs it serves these routes.
import { getClient, after, getContextId } from "./calimero";

const HEX_32 = /^[0-9a-f]{64}$/;

/**
 * The hex id of a blob, or "" when `value` is not one. Accepts `0x`-prefixed
 * and upper-case hex; byte arrays of 32.
 */
export function toBlobIdHex(value: string | number[] | Uint8Array): string {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (bytes.length !== 32) return "";
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  const unprefixed = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return HEX_32.test(unprefixed) ? unprefixed : "";
}

/** True when `value` names a blob that could be fetched. */
export function isUsableBlobId(value: string | number[] | Uint8Array): boolean {
  return toBlobIdHex(value).length === 64;
}

function requireApp(contextId: string | undefined, operation: string): string {
  const id = (contextId ?? "").trim();
  if (!id) throw new Error(`${operation} needs the conversation's app id.`);
  return id;
}

export interface BlobUploadResult {
  blobId: string;
  size: number;
}

/** Stores `data` as a blob of the app instance `contextId`. */
export async function uploadBlob(
  data: Blob | ArrayBuffer | Uint8Array,
  contextId: string,
): Promise<BlobUploadResult> {
  const app = requireApp(contextId, "uploadBlob");
  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(await data.arrayBuffer());
  try {
    const res = await getClient().apps.blobUpload({ app, body: bytes, contentType: 'application/octet-stream' });
    const blobId = toBlobIdHex(res?.id ?? "");
    if (!blobId) throw new Error(`The node returned a blob id this app cannot use: ${String(res?.id)}`);
    return { blobId, size: res?.size ?? bytes.length };
  } finally {
    after();
  }
}

/** A blob of the app instance `contextId`, as a `Blob` (for object URLs). */
export async function downloadBlob(blobId: string, contextId: string): Promise<Blob> {
  const app = requireApp(contextId, "downloadBlob");
  const id = toBlobIdHex(blobId);
  if (!id) throw new Error(`Not a usable blob id: ${blobId}`);
  try {
    const bytes = await getClient().downloadBlob(app, id);
    return new Blob([bytes as BlobPart]);
  } finally {
    after();
  }
}

/**
 * Deletes a blob of the conversation on screen (or `contextId`). Only the
 * app's owner or an org admin may; anyone else's delete is refused, which a
 * caller treats as best-effort cleanup.
 */
export async function deleteBlob(blobId: string, contextId?: string): Promise<void> {
  const id = toBlobIdHex(blobId);
  const app = (contextId ?? getContextId() ?? "").trim();
  if (!id || !app) return;
  try {
    await getClient().apps.blobDelete({ app, id });
  } finally {
    after();
  }
}

/** A 404 from a blob route, however the transport surfaced it. */
export function isNotFound(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status === 404) return true;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return /\b404\b|not found/i.test(message);
}
