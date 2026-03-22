import bs58 from 'bs58';

const HEX_64 = /^[0-9a-fA-F]{64}$/;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Admin join-context JSON expects `ContextId` as base58. List endpoints may return hex.
 * If `contextId` is a 64-char hex string, convert bytes → base58; otherwise return as-is.
 */
export function normalizeContextIdForJoin(contextId: string): string {
  const trimmed = contextId.trim();
  if (HEX_64.test(trimmed)) {
    return bs58.encode(hexToBytes(trimmed));
  }
  return trimmed;
}

/**
 * Build context ID candidates for API calls that may accept either hex or base58.
 * If input is hex, returns [base58, hex]; otherwise returns [normalized].
 */
export function buildContextIdCandidates(contextId: string): string[] {
  const normalized = contextId.trim();
  const maybeBase58 = hexToBase58(normalized);
  if (maybeBase58 && maybeBase58 !== normalized) {
    return [maybeBase58, normalized];
  }
  return [normalized];
}

/**
 * Convert a hex string to base58. Returns null if input is not valid hex.
 */
function hexToBase58(value: string): string | null {
  const cleaned = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    return null;
  }
  return bs58.encode(hexToBytes(cleaned));
}
