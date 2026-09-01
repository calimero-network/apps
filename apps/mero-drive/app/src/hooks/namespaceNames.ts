// Persisted namespace display names — captured at join time.
//
// `listNamespacesForApplication` omits a namespace's `name` until the
// node has synced its root-group metadata. On a *joined* node that
// metadata can lag indefinitely (small-cluster gossip), so the
// workspace switcher would show the raw namespace id forever.
//
// But the name IS known at join time: core's `createNamespaceInvitation`
// resolves it (`groupName`) on the inviter's node, and mero-drive
// carries it on the invite URL (`&name=`). The join flow records it
// here so the switcher can show it immediately — no dependency on
// metadata sync.
//
// This is a denormalized snapshot: if the namespace is renamed later,
// the stored value is stale until metadata sync delivers the canonical
// name. Acceptable for a display label, and the same trade-off the
// invite's other inviter-populated fields (`source`, `blob_id`) make.

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
