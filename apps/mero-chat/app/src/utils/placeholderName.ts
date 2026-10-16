/**
 * True when a "name" is really a stand-in for an account with no name.
 *
 * Nameless members are shown as a shortened account (`3e76…db86`, see
 * `shortAccount`), the raw account itself, or a fixed label. None of those is
 * something a person chose, so an avatar must not take initials from it: the
 * first character of a key ("3") reads as a count or a notification badge.
 */
const SHORT_ACCOUNT = /^[0-9a-z]{2,12}(…|\.\.\.)[0-9a-z]{2,12}$/i;
const HEX_ACCOUNT = /^[0-9a-f]{64}$/i;
const BASE58_ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LABELS = new Set(["unknown", "unnamed member"]);

export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  return (
    SHORT_ACCOUNT.test(n) ||
    HEX_ACCOUNT.test(n) ||
    BASE58_ACCOUNT.test(n) ||
    LABELS.has(n.toLowerCase())
  );
}
