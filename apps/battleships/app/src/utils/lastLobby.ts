/**
 * The lobby you had open last, so a reload (or signing in again) goes back in.
 *
 * A bare `/lobby` used to stop on the lobby picker every time: the open lobby
 * lived only in view state and `?id=`, and every way back into the app — the
 * post-login redirect `/` → `/home` → `/lobby` included — drops the query.
 *
 * Not `battleships:selectedNamespaceId`: that is the picker's preselection,
 * set to the first lobby whether or not you ever entered it. This is only
 * written once you are IN a lobby.
 *
 * Scoped to the NODE: one browser can sign in to several nodes, and a
 * namespace id from one means nothing on another. It is only a hint — checked
 * against what the node lists right now before anything opens, so a lobby you
 * have since left falls back to the picker instead of a screen that can only
 * fail (the rule mero-design's `lastVisit` uses).
 */

const PREFIX = 'battleships:last-lobby:';

/** The storage key for one node. Exported for tests. */
export function lastLobbyKey(nodeUrl: string | null | undefined): string {
  return `${PREFIX}${(nodeUrl ?? '').replace(/\/+$/, '') || 'local'}`;
}

export function readLastLobby(nodeUrl: string | null | undefined): string | null {
  try {
    return localStorage.getItem(lastLobbyKey(nodeUrl)) || null;
  } catch {
    // Blocked storage is a cold start, not a failure.
    return null;
  }
}

export function rememberLobby(nodeUrl: string | null | undefined, namespaceId: string): void {
  if (!namespaceId) return;
  try {
    localStorage.setItem(lastLobbyKey(nodeUrl), namespaceId);
  } catch {
    // quota / private mode: forgetting is fine
  }
}

/** Forget it: you went back to the picker, logged out, or it is gone. */
export function forgetLastLobby(nodeUrl: string | null | undefined): void {
  try {
    localStorage.removeItem(lastLobbyKey(nodeUrl));
  } catch {
    // nothing to forget
  }
}

/**
 * The lobby to resume on a bare `/lobby`: the remembered one if the node still
 * lists it. Never a guess — with nothing (valid) remembered, the picker shows.
 */
export function pickResumeLobby(
  listed: readonly string[],
  remembered: string | null,
): string | null {
  return remembered && listed.includes(remembered) ? remembered : null;
}
