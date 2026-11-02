// ── Blob ids are HEX ────────────────────────────────────────────────────────
//
// A blob's id is `hex(SHA-256(bytes))`: what `client.uploadBlob` answers as
// `id`, what the contract stores (it refuses anything but 64 hex digits), and
// what `client.downloadBlob` takes. v1 also had to read legacy base58 ids
// minted by an older build; a component app's state starts empty, so there are
// none left to read.

/** 32 bytes, hex. */
const HEX_32 = /^[0-9a-fA-F]{64}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Canonicalise a blob id into lowercase hex: hex (with or without `0x`), or a
 * 32-byte array. Returns "" for anything else, so a caller knows it has no
 * blob to fetch rather than sending the node an id it will refuse.
 */
export function toBlobIdHex(value: string | number[] | Uint8Array): string {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return bytes.length === 32 ? bytesToHex(bytes) : '';
  }
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const unprefixed = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  return HEX_32.test(unprefixed) ? unprefixed.toLowerCase() : '';
}

/** True when `value` can be turned into a blob id the node will accept. */
export function isUsableBlobId(value: string | number[] | Uint8Array): boolean {
  return toBlobIdHex(value).length === 64;
}
