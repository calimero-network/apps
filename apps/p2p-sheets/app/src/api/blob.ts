/**
 * Blob (file/image) upload + download against the node blob store.
 *
 * mero-js exposes `admin.uploadBlob`/`admin.getBlob`, but those JSON-wrap the
 * body / return only metadata — unusable for raw binary. So we hit the
 * `/admin-api/blobs` endpoint directly with the access token:
 *   - upload: PUT raw bytes (octet-stream) → `{ blobId, size }`
 *   - download: GET `/admin-api/blobs/<id>?context_id=<ctx>` → `Blob`
 *
 * The token lives in the `mero-tokens` localStorage blob written by mero-js's
 * LocalStorageTokenStore (see auth notes); read it the same way.
 */
import { getNodeUrl } from '@calimero-network/mero-react';

/** Max upload size — mirrors the contract's `MAX_ATTACHMENT_SIZE` (25 MiB). */
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

export interface UploadedBlob {
  blobId: string;
  size: number;
}

/** Read the current access token from mero-js's token store blob. */
export function getAccessToken(): string {
  try {
    const raw = localStorage.getItem('mero-tokens');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed?.access_token ?? '';
  } catch {
    return '';
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAccessToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

function requireNodeUrl(): string {
  const url = getNodeUrl();
  if (!url) throw new Error('Node URL is not set — connect a node first.');
  return url;
}

/**
 * Upload a file's bytes to the node blob store. Returns the blob id + size,
 * which the caller stores on a message via `send_attachment`.
 */
export async function uploadBlob(file: File): Promise<UploadedBlob> {
  if (file.size === 0) throw new Error('File is empty.');
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error(`File is too large (max ${Math.floor(MAX_ATTACHMENT_SIZE / (1024 * 1024))} MB).`);
  }
  const buffer = await file.arrayBuffer();
  const res = await fetch(new URL('/admin-api/blobs', requireNodeUrl()).toString(), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/octet-stream' }),
    body: buffer,
    // Fail fast instead of hanging forever if the node stalls.
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  // Server may double-wrap (`{ data: {...} }`) and use snake_case (`blob_id`).
  const raw = json?.data ?? json;
  const blobId = raw?.blobId ?? raw?.blob_id;
  if (!blobId) throw new Error('Upload succeeded but no blob id was returned.');
  return { blobId, size: raw?.size ?? file.size };
}

/**
 * Download a blob's bytes as a `Blob`. `contextId` scopes the read to the
 * context the attachment belongs to (the node enforces access by context).
 */
export async function downloadBlob(blobId: string, contextId: string): Promise<Blob> {
  const url = new URL(`/admin-api/blobs/${encodeURIComponent(blobId)}`, requireNodeUrl());
  if (contextId) url.searchParams.set('context_id', contextId);
  // Fail fast: without a timeout a stalled node leaves the image stuck loading.
  const res = await fetch(url.toString(), { method: 'GET', headers: authHeaders(), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  return res.blob();
}

/** True for MIME types we render inline as an image. */
export function isImageMime(mime: string | undefined | null): boolean {
  return !!mime && mime.startsWith('image/');
}

/** Human-readable byte size (e.g. "1.4 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  const str = i === 0 || Number.isInteger(val) ? String(Math.round(val)) : val.toFixed(1);
  return `${str} ${units[i]}`;
}
