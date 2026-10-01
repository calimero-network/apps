// Dev-only overlay used by `make start`.
//
// `scripts/dev-invite.sh` writes `/dev-overlay.json` containing the
// namespace's alias (and a couple of related ids) so node-2's webapp
// can show the proper "Dev Workspace" label instead of the hex slice.
// This is a workaround for needs-fix.md A2 — rc.35 governance ops
// don't propagate the namespace alias to non-admin joiners.
//
// In production the file is absent; the fetch returns 404 and we no-op.

const GROUP_ALIASES_STORAGE_KEY = "calimero_group_aliases";

export interface DevOverlay {
  namespace_id: string;
  namespace_alias: string;
  general_context_id?: string;
  general_subgroup_id?: string;
  node_2_member_key?: string;
}

/**
 * Read the dev overlay (if present) and seed `localStorage` with the
 * namespace alias so the workspace selector renders it. Returns `true`
 * if a fresh write was performed, `false` otherwise (file absent,
 * malformed, or alias already present).
 */
export async function applyDevOverlay(
  fetchFn: typeof fetch = fetch,
  storage: Storage = localStorage,
  sessionStore: Storage = sessionStorage,
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetchFn("/dev-overlay.json", { cache: "no-store" });
  } catch {
    return false;
  }
  if (!res.ok) return false;

  let overlay: DevOverlay;
  try {
    overlay = (await res.json()) as DevOverlay;
  } catch {
    return false;
  }
  if (!overlay?.namespace_id || !overlay?.namespace_alias) return false;

  let map: Record<string, string> = {};
  try {
    const raw = storage.getItem(GROUP_ALIASES_STORAGE_KEY);
    if (raw) map = JSON.parse(raw) as Record<string, string>;
  } catch {
    map = {};
  }

  if (map[overlay.namespace_id] === overlay.namespace_alias) return false;

  map[overlay.namespace_id] = overlay.namespace_alias;
  const serialized = JSON.stringify(map);
  storage.setItem(GROUP_ALIASES_STORAGE_KEY, serialized);
  sessionStore.setItem(GROUP_ALIASES_STORAGE_KEY, serialized);
  return true;
}
