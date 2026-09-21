// ── Blob ids are HEX ────────────────────────────────────────────────────────
//
// ⚠️ THE BUG THIS MODULE EXISTS TO END.
//
// Three places in this app converted the node's blob id to BASE58 before
// handing it to the contract, under a comment that said "the contract expects
// base58-encoded 32-byte blob IDs". That was true before core 0.11.0-rc.27,
// which removed base58 from the wire. The contract stores `blob_id_str`
// verbatim — it does not care — but the NODE does, and the node is who gets
// asked for the bytes back:
//
//     "Failed to decode blob ID (expected hex)
//      'EV2HzEPbzzmRGyHke9CFbKFfgvWYheS7ZBLkgu1xEo6': Odd number of digits"
//
// It is a write-then-read failure, which is why it looked like three unrelated
// bugs: the upload succeeds, the contract call succeeds, and the document or
// signature only fails later, when something tries to display it. The
// signature library's read path caught and swallowed it — `catch { /* a
// signature with no image still lists, as a named row */ }` — so a drawn
// signature saved, appeared in the list, and was blank forever with nothing
// logged.
//
// ── Why this still reads base58 ─────────────────────────────────────────────
//
// Because ids minted by the old code are already in the contract, and those
// documents and signatures are not junk — the blob is still on the node, under
// the hex id the base58 was derived from. Decoding one back is exact, so a
// library recorded by a previous build keeps working rather than silently
// showing blanks forever.

import bs58 from 'bs58';

/** 32 bytes, hex — what `GET /admin-api/blobs/:id` accepts. */
const HEX_32 = /^[0-9a-fA-F]{64}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Canonicalise whatever a blob id arrived as into the hex the node wants.
 *
 * Accepts, in order:
 *   * hex, with or without an `0x` prefix — returned lowercase
 *   * a byte array, which is how the contract hands back a `[u8; 32]`
 *   * base58 that decodes to 32 bytes — a legacy id, written by a build that
 *     converted before storing
 *
 * Returns "" for anything else, rather than passing a string the node will
 * reject with a message about hex digits. A caller that gets "" knows it has
 * no blob to fetch, which is actionable; a 500 from the node is not.
 */
export function toBlobIdHex(value: string | number[] | Uint8Array): string {
  if (Array.isArray(value) || value instanceof Uint8Array) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return bytes.length === 32 ? bytesToHex(bytes) : '';
  }
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  if (!trimmed) return '';
  const unprefixed = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (HEX_32.test(unprefixed)) return unprefixed.toLowerCase();

  // Not hex. The only other thing it can legitimately be is a legacy base58
  // id — and `bs58.decode` throws on anything outside the alphabet, which is
  // the check, so there is no separate shape test to keep in step with it.
  try {
    const bytes = bs58.decode(trimmed);
    return bytes.length === 32 ? bytesToHex(bytes) : '';
  } catch {
    return '';
  }
}

/** True when `value` can be turned into a blob id the node will accept. */
export function isUsableBlobId(value: string | number[] | Uint8Array): boolean {
  return toBlobIdHex(value).length === 64;
}
