/**
 * Invitation share-code encoding.
 *
 * A raw namespace invitation is a large JSON object full of byte arrays
 * (e.g. `inviter_identity: [117, 166, …]`) — ugly and fragile to copy/paste.
 * We wrap it in a single compact, copy-safe **base64** token for sharing, and
 * decode it back on join. `decodeInvitation` also accepts raw JSON so older
 * links (and hand-pasted JSON) keep working.
 */

/** Encode any JSON-serialisable invitation object to a base64 share code. */
export function encodeInvitation(invitation: unknown): string {
  return base64FromUtf8(JSON.stringify(invitation));
}

/**
 * Decode a share code back to the invitation object. Accepts either:
 *   - a base64 token produced by `encodeInvitation`, or
 *   - raw JSON (backward compatibility).
 * Throws if the input is neither.
 */
export function decodeInvitation(input: string): unknown {
  const s = input.trim();
  if (!s) throw new Error('Empty invitation.');

  // Raw JSON (back-compat): base64 of a JSON object never starts with { or [.
  if (s.startsWith('{') || s.startsWith('[')) {
    return JSON.parse(s);
  }

  // Otherwise treat it as a base64 token → JSON.
  let json: string;
  try {
    json = utf8FromBase64(s);
  } catch {
    throw new Error('Invitation code is not valid base64.');
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('Invitation code does not contain a valid invitation.');
  }
}

// ── base64 <-> UTF-8 helpers (browser + Node) ──────────────────────────────
function base64FromUtf8(s: string): string {
  if (typeof btoa === 'function' && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  // Node fallback (e.g. unit tests on older runtimes).
  return Buffer.from(s, 'utf-8').toString('base64');
}

function utf8FromBase64(b64: string): string {
  const clean = b64.replace(/\s+/g, '');
  if (typeof atob === 'function' && typeof TextDecoder !== 'undefined') {
    const bin = atob(clean);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(clean, 'base64').toString('utf-8');
}
