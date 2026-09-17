// A per-browser snapshot of namespace display names, captured at join time.
//
// ⚠️ NOT the mechanism by which a name reaches another node. That is
// `groupName` on the join request (see useNamespaceInvitation): the joiner
// hands the invite-carried name to its OWN node, which files it against its
// governance row, where every tab, every later session and the desktop app —
// which shares the node, not this localStorage — all read it.
//
// This file is the gap-filler for the window in between. core's
// `listNamespacesForApplication` omits a namespace's `name` until the node has
// synced its root-group metadata, and on a small cluster that can lag; the
// snapshot lets the workspace switcher show the real name in the meantime.
//
// It is read ONLY when the node reports no name of its own (see
// useNamespaceDisplayNames), so it can never shadow a rename, and a browser
// that never took the snapshot — a second device, a cleared profile — is not
// worse off than before: the node answers, just later.

const STORAGE_KEY = 'mero-drive:namespace-names';

/** All `{ namespaceId: name }` pairs captured at join time. */
export function getRememberedNamespaceNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** Record a namespace's display name (from an accepted invite). */
export function rememberNamespaceName(
  namespaceId: string,
  name: string,
): void {
  if (!namespaceId || !name) return;
  try {
    const all = getRememberedNamespaceNames();
    if (all[namespaceId] === name) return;
    all[namespaceId] = name;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable (private mode / quota) — non-fatal;
    // the switcher just falls back to the namespace id.
  }
}
