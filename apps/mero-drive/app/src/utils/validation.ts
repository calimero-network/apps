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

// Rough sanity-check on the pubkey format — Calimero identities
// are base58-encoded Ed25519 pubkeys, which for a 32-byte key land
// in the 43-44 char range. {40,50} gives some slack for prefixed or
// versioned variants while still tightly enough scoped to catch
// obviously-garbage input (typos, truncated paste, etc). This is a
// client-side UX guard — the node validates the actual format.
//
// The character class IS the canonical Bitcoin base58 alphabet:
// `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`
// — no `0 O I l`. Decoded range-by-range:
//   1-9    → digits (no 0)
//   A-H    → no I (65..72; I is 73)
//   J-N    → no I before, no O after (74..78; O is 79)
//   P-Z    → no O
//   a-k    → no l (97..107; l is 108)
//   m-n    → skips l
//   p-z    → skips o (o is 111)
export const MEMBER_IDENTITY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{40,50}$/;

export function looksLikeMemberIdentity(raw: string): boolean {
  return MEMBER_IDENTITY_PATTERN.test(raw);
}
