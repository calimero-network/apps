/**
 * The set of namespaces this browser session has just joined and is still
 * waiting on.
 *
 * `sessionStorage`, not `localStorage`: the flag exists to cover the window
 * between a join returning and that namespace's state arriving. Surviving a
 * browser restart would mean gating a workspace that settled days ago.
 *
 * One key, shared by every app on the origin, and deliberately so. The value is
 * a namespace id — globally unique — so "you just joined namespace X" is true
 * for any app that can see X, not just the one that accepted the invite. The
 * watchdog in `useJoinSync` bounds how long a stale entry can matter, so an app
 * that sets the flag and navigates away cannot strand another one.
 */
const KEY = "calimero:justJoinedNamespaces";

/** Reading storage can throw outright — Safari private mode, blocked site data. */
function read(): Set<string> {
  try {
    if (typeof sessionStorage === "undefined") return new Set();
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function write(set: Set<string>): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Storage is a convenience here. A session that cannot persist the flag
    // simply does not get the gate; it must never break the join itself.
  }
}

/**
 * Call this the moment a join succeeds, before navigating. The app that reads
 * the flag is usually a different route from the one that accepted the invite.
 */
export function markNamespaceJustJoined(namespaceId: string): void {
  if (!namespaceId) return;
  const set = read();
  if (set.has(namespaceId)) return;
  set.add(namespaceId);
  write(set);
}

export function clearNamespaceJustJoined(namespaceId: string): void {
  const set = read();
  if (!set.delete(namespaceId)) return;
  write(set);
}

export function isNamespaceJustJoined(namespaceId: string | null): boolean {
  if (!namespaceId) return false;
  return read().has(namespaceId);
}

/** Test seam. Not part of the app-facing API. */
export function __readJustJoinedSet(): Set<string> {
  return read();
}
