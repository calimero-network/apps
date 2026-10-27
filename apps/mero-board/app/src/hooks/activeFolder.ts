/**
 * Which folder to open when the session arrived with an SSO / desktop callback
 * context (a deep link into one folder).
 *
 * Precedence:
 *  - a callback that arrives on this load wins over any folder picked in an
 *    EARLIER session (a stale pick must not swallow a deep link);
 *  - a folder picked AFTER that callback, in the same session, wins over it,
 *    including across a reload that still carries the same callback.
 *
 * "Same session" is told apart by recording, next to the pick, the callback id
 * it was made under: a pick only beats the callback it was made after.
 */
export interface CallbackFolderInput {
  /** The callback context on this load, or null when the session has none. */
  callbackContextId: string | null;
  /** False while the callback's namespace is still resolving (nothing can be read yet). */
  nsKnown: boolean;
  /** The persisted folder pick for this namespace. */
  pick: string | null;
  /** The callback id that was current when `pick` was made. */
  pickCallback: string | null;
  /** The folders the namespace lists right now (may still be loading, i.e. empty). */
  folderIds: readonly string[];
}

export interface CallbackFolderDecision {
  folder: string;
  /** The folder is the user's own pick (it then holds until they pick again). */
  userPick: boolean;
  /** Record the callback as the current choice, replacing a stale pick. */
  persist: boolean;
}

/** Null when there is no callback: the ordinary persisted / first-folder path applies. */
export function decideCallbackFolder(i: CallbackFolderInput): CallbackFolderDecision | null {
  const cb = i.callbackContextId;
  if (!cb) return null;
  if (!i.nsKnown) return { folder: cb, userPick: false, persist: false };
  const pickFollowsThisCallback = !!i.pick && i.pick !== cb && i.pickCallback === cb;
  if (pickFollowsThisCallback) {
    if (i.folderIds.includes(i.pick as string)) return { folder: i.pick as string, userPick: true, persist: false };
    // The folder list is still loading (or the picked folder is gone): show the
    // callback meanwhile, but keep the pick on record so it can still win.
    return { folder: cb, userPick: false, persist: false };
  }
  return { folder: cb, userPick: false, persist: true };
}
