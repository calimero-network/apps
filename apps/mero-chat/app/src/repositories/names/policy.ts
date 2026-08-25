import type { RepositoryPolicy } from "../core/types";

/**
 * Policy for account → display name.
 *
 * The value is a person's chosen name, held in namespace member metadata. It
 * changes rarely, it is cheap, and it is needed by almost every rendered row.
 *
 * - `ttlMs: 5 min` — long enough that scrolling a channel costs nothing, short
 *   enough that a rename made on another device shows up without a reload.
 *   A rename made HERE does not wait for it: the write path invalidates.
 *
 * - `staleWhileRevalidate: true` — a name one minute out of date is a far better
 *   answer than a placeholder that resolves a moment later, because the
 *   placeholder is what users read as "the app is broken". Names are display
 *   only; nothing authorises against them, so serving a stale one is never a
 *   correctness decision. (That is exactly why they must never be compared as
 *   identity — see `sameAccount`.)
 *
 * - `persist: true` — safe: a display name is already public to every member of
 *   the namespace, so storing it locally reveals nothing the member list does
 *   not. Persisting is what stops a reload showing a screen full of truncated
 *   accounts while the first fetch is in flight. Stored in IndexedDB, like
 *   everything else here.
 *
 * - `negativeTtlMs: 1 min` — plenty of accounts genuinely have no name yet.
 *   Without negative caching each one re-asks the node on every render; with it,
 *   a member who sets a name still appears within the minute.
 */
export const NAME_POLICY: RepositoryPolicy = {
  ttlMs: 5 * 60 * 1000,
  staleWhileRevalidate: true,
  persist: true,
  negativeTtlMs: 60 * 1000,
};
