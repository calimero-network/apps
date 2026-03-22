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
  return contextId;
}
