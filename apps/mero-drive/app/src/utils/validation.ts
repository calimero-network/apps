// Shared input validators for folder / namespace UIs. Keeping these
// in one place so the create + rename flows enforce identical rules
// and can't drift — Bugbot caught one such drift risk on Phase 8-B.

// Allowlist of CSS color strings we're willing to pass into inline
// style. folder.color ultimately comes from registry WASM state
// that peers can write, so we defence-in-depth against injected
// non-color values. Hex branch explicitly lists the valid lengths
// (3 shorthand-rgb, 4 shorthand-rgba, 6 rgb, 8 rgba) to avoid
// accepting malformed {5, 7}-char hex strings.
export const COLOR_ALLOWLIST = /^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([\d.,\s%/]+\)|hsla?\([\d.,\s%/]+\))$/;

/** Returns the color string if it matches the allowlist, else
 *  undefined. Callers typically fall back to an icon or default
 *  color when this returns undefined. */
export function safeColor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return COLOR_ALLOWLIST.test(trimmed) ? trimmed : undefined;
}

// Rough sanity-check on the pubkey format — Calimero identities are
// Ed25519 device keys. core 0.11.0-rc.27 removed base58 (core#3691), so a
// 32-byte key is now exactly 64 hex characters. This is a client-side UX
// guard (catch typos / truncated paste); the node validates the real format,
// and the registry service lower-cases what it stores.
//
// Case-insensitive on purpose: the admin API returns lower-case, but a hand-
// pasted key may be upper-case, and `validate_member_key` normalises either.
export const MEMBER_IDENTITY_PATTERN = /^[0-9a-fA-F]{64}$/;

export function looksLikeMemberIdentity(raw: string): boolean {
  return MEMBER_IDENTITY_PATTERN.test(raw);
}
