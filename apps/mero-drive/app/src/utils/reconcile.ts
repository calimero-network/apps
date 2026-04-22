// Drift resolution between admin-API groups (source of truth for the
// group tree) and the registry WASM state (source of truth for folder
// metadata). Produces a minimal action set to bring registry back in
// line with admin. Pure — the hook wrapping this does the I/O.
//
// The three drift cases from the design spec:
//   - "register":   admin has the group, registry is missing it
//   - "unregister": registry has the folder, admin no longer has the group
//   - "move":       both sides know the folder, but parent_id disagrees
//
// The namespace root group is in `admin` but is NOT tracked in the
// registry (the registry tracks *subfolders* under root). Filtering it
// out is required — otherwise a healthy workspace would try to
// unregister its own root on every reconcile.

export interface AdminGroup {
  id: string;
  parent_id: string | null;
  alias?: string;
}

export interface RegistryFolder {
  id: string;
  parent_id: string | null;
}

export interface ReconcileActions {
  register: { id: string; parent_id: string | null }[];
  unregister: string[];
  move: { id: string; new_parent_id: string | null }[];
}

export function computeReconcileActions(
  admin: AdminGroup[],
  registry: RegistryFolder[],
  rootId: string,
): ReconcileActions {
  const adminByIdSansRoot = new Map(
    admin.filter((g) => g.id !== rootId).map((g) => [g.id, g]),
  );
  const regById = new Map(registry.map((f) => [f.id, f]));

  const register: ReconcileActions['register'] = [];
  const move: ReconcileActions['move'] = [];
  for (const g of adminByIdSansRoot.values()) {
    const reg = regById.get(g.id);
    if (!reg) {
      register.push({ id: g.id, parent_id: g.parent_id });
    } else if (reg.parent_id !== g.parent_id) {
      move.push({ id: g.id, new_parent_id: g.parent_id });
    }
  }

  const unregister: string[] = [];
  for (const f of registry) {
    if (!adminByIdSansRoot.has(f.id)) unregister.push(f.id);
  }

  return { register, unregister, move };
}
