// Which images a document may hold. The type is read from the file's own
// bytes: the extension and the browser's MIME type are only the sender's claim.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // the largest image a document takes
const BLOB_REF = /^blob:([0-9a-f]{64})$/; // an image block's url names a blob, never an address
const SNIFF_BYTES = 12; // enough for the longest signature below (WebP)

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const at = (bytes: Uint8Array, offset: number, signature: string) =>
  [...signature].every((c, i) => bytes[offset + i] === c.charCodeAt(0));

/** The image type the bytes start with, or null for anything else (SVG included). */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (at(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'image/png';
  if (at(bytes, 0, '\xff\xd8\xff')) return 'image/jpeg';
  if (at(bytes, 0, 'GIF87a') || at(bytes, 0, 'GIF89a')) return 'image/gif';
  if (at(bytes, 0, 'RIFF') && at(bytes, 8, 'WEBP')) return 'image/webp';
  return null;
}

/** Whether `file` may be added to a document; a wrong type is reported before the size. */
export async function checkImageFile(
  file: Blob,
): Promise<{ type: ImageType } | { error: 'type' | 'size' }> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const type = sniffImageType(head);
  if (!type) return { error: 'type' };
  if (file.size > MAX_IMAGE_BYTES) return { error: 'size' };
  return { type };
}

/** What an image block stores as its url. */
export const blobRef = (blobId: string) => `blob:${blobId}`;

/** The blob id an image block's url names, or null when it names anything else. */
export function parseBlobRef(url: string): string | null {
  return BLOB_REF.exec(url)?.[1] ?? null;
}
