import type { Attachment } from "./generated/HyperfeedClient";

/**
 * Images on a message to your agent: the contract's limits, checked here first
 * so a wrong file is turned away before anything is uploaded.
 */

/** What the contract accepts, and what your agent can look at. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Where an image's bytes live: a blob on your node, announced to the feed's context. */
export interface BlobStore {
  upload(data: Blob): Promise<{ blobId: string; size: number }>;
  read(blobId: string): Promise<Blob>;
}

/** Why a file cannot go with a message, or null when it can. `already`: images already picked. */
export function refuseImage(file: { name: string; type: string; size: number }, already: number): string | null {
  const name = file.name || "That image";
  if (already >= MAX_ATTACHMENTS) return `At most ${MAX_ATTACHMENTS} images per message.`;
  if (!IMAGE_TYPES.includes(file.type)) return `${name} isn't a PNG, JPEG, WebP or GIF image.`;
  if (file.size === 0) return `${name} is empty.`;
  if (file.size > MAX_IMAGE_BYTES) return `${name} is ${megabytes(file.size)}; the limit is 10 MB.`;
  return null;
}

/** Upload one picked image and describe it for `say_with`. */
export async function uploadImage(store: BlobStore, file: File): Promise<Attachment> {
  const { blobId, size } = await store.upload(file);
  return { blob_id: blobId, name: file.name.slice(0, 120), mime: file.type, size: size || file.size };
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
