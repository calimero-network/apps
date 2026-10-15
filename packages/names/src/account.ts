import bs58 from "bs58";

/**
 * Canonical form of an account id: 64 lowercase hex.
 *
 * The admin API reports accounts as hex, while a contract stamps
 * `env::account_id()` as base58 (`UserId<32, 44>`). Comparing the raw strings
 * silently misses, so every lookup goes through this first. Returns `undefined`
 * for anything that is neither form of a 32-byte key.
 */
export function canonicalAccount(id: string | null | undefined): string | undefined {
  const s = id?.trim();
  if (!s) return undefined;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  try {
    const bytes = bs58.decode(s);
    if (bytes.length !== 32) return undefined;
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}

/** Whether two ids name the same account, whichever encoding each is in. */
export function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalAccount(a);
  return !!ca && ca === canonicalAccount(b);
}

/**
 * An id shortened for display when nothing has named it: `5926f2…1334`.
 *
 * True, unlike a name captured earlier, so it is the one fallback every app
 * uses. Never the primary label when a name is known.
 */
export function shortAccount(id: string | null | undefined, head = 6, tail = 4): string {
  const s = id?.trim() ?? "";
  if (!s) return "unknown";
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}
