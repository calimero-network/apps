// Workspace folder tree — merges admin-API subgroup entries (source
// of truth for tree shape, aliases, and subgroup_visibility per core
// PR #2261) with registry FolderDto entries (source of truth for
// color + context binding + parent_id index).
//
// `mergeAdminAndRegistry` is exported separately so the pure merge
// logic can be tested without rendering the hook. The hook wrapper
// adds reactive fetching via mero-react's useSubgroups plus a
// RegistryClient.getFolders() call on mount / client change.
//
// Admin subgroup entries use `{ groupId, alias? }` (per mero-js's
// SubgroupEntry type). Registry entries use `{ id, parent_id, … }`
// (per the generated FolderDto). The merge reconciles the two shapes.

import { useEffect, useMemo, useState } from 'react';
import type { SubgroupEntry } from '@calimero-network/mero-react';
import type { RegistryClient } from '../api/registry/RegistryClient';

export interface AdminSubgroup {
  groupId: string;
  parent_id: string | null;
  alias?: string;
}

export interface RegistryFolderShape {
  id: string;
  parent_id: string | null;
  color: string | null;
  /** Registry-side alias. Set by useFolderOperations.create /
   *  rename; readable by every namespace member regardless of
   *  subgroup membership. Null / undefined for legacy folders
   *  created before the registry contract gained the alias field. */
  alias?: string | null;
}

export interface MergedFolder {
  id: string;
  parent_id: string | null;
  alias: string;
  /** Sourced from core's GroupInfo.subgroupVisibility per PR #2261.
   *  `undefined` while the per-folder fetch is still in flight. */
  visibility: 'Open' | 'Restricted' | undefined;
  color: string | null;
}

// The registry WASM is the authoritative source of "which folders
// exist" (it owns the tree shape + color + context binding). Admin-
// side subgroups contribute `alias` (human-readable name) and
// `subgroup_visibility` (Open vs Restricted, per core PR #2261).
// Iterate the registry list so that folders show up even when
// mero-js's listSubgroups is broken (it expects a `{data}` wrapper
// but core returns `{subgroups}` — the folder body resolves to
// undefined and admin comes back empty). Alias falls back to a
// shortened id so the folder still renders and is clickable with
// `admin` empty. Visibility falls back to undefined while the
// per-folder getGroupInfo fetch is in flight.
export function mergeAdminAndRegistry(
  admin: AdminSubgroup[],
  registry: RegistryFolderShape[],
  rootId: string,
  visibilityById?: Map<string, 'Open' | 'Restricted'>,
): { folders: MergedFolder[] } {
  const adminById = new Map(admin.map((a) => [a.groupId, a]));
  const folders: MergedFolder[] = registry
    .filter((r) => r.id !== rootId)
    .map((r) => {
      const a = adminById.get(r.id);
      // Preference order: registry alias (visible to all namespace
      // members) → admin alias (only visible to subgroup members) →
      // truncated id stub (fallback for folders older than the
      // registry alias field).
      const alias =
        r.alias ?? a?.alias ?? `folder-${r.id.slice(0, 8)}`;
      return {
        id: r.id,
        parent_id: r.parent_id,
        alias,
        visibility: visibilityById?.get(r.id),
        color: r.color,
      };
    });
  return { folders };
}

export interface WorkspaceTreeState {
  folders: MergedFolder[];
  loading: boolean;
  error: Error | null;
}

// `adminSubgroups` is the already-fetched list (passed in from the
// caller's useSubgroups() / useNamespaceGroups() hook). Keeping the
// fetch out of this hook lets the caller decide which mero-react
// hook to subscribe to without this module pinning the choice.
export function useWorkspaceTree(
  rootGroupId: string | null,
  registryClient: RegistryClient | null,
  adminSubgroups: SubgroupEntry[],
  adminLoading: boolean,
): WorkspaceTreeState {
  const [regFolders, setRegFolders] = useState<RegistryFolderShape[]>([]);
  const [regLoading, setRegLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!registryClient) {
      setRegLoading(true);
      return;
    }
    let alive = true;
    setRegLoading(true);
    registryClient
      .getFolders()
      .then((fs) => {
        if (!alive) return;
        setRegFolders(
          fs.map((f) => ({
            id: f.id,
            parent_id: f.parent_id ?? null,
            color: f.color ?? null,
          })),
        );
        setError(null);
        setRegLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setRegLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [registryClient]);

  // SubgroupEntry has no parent_id in the admin-API response — it's
  // the flat list of descendants of rootGroupId. The registry's
  // parent_id is what we actually use for the tree shape; admin just
  // gives us membership + alias.
  //
  // Use an explicit ternary (not `?? rootGroupId`) so a registered
  // folder with parent_id:null stays null — `null` is the shared
  // convention for "top-level" across registerFolder, useReconcile,
  // and the UI code that will render the tree. Only fall back to
  // rootGroupId when the registry has no entry at all (admin-seen
  // but unregistered — reconcile will surface it).
  //
  // Wrap in useMemo and pre-build a Map for O(1) lookups: this runs
  // in the render path of RegistryProvider (re-renders on every
  // subgroup or registry change), and large workspaces would
  // otherwise pay O(n×m) per render from the nested find().
  const { folders } = useMemo(() => {
    if (!rootGroupId) return { folders: [] };
    const regById = new Map(regFolders.map((r) => [r.id, r]));
    const admin: AdminSubgroup[] = adminSubgroups.map((s) => {
      const fromReg = regById.get(s.groupId);
      return {
        groupId: s.groupId,
        parent_id: fromReg ? fromReg.parent_id : rootGroupId,
        alias: s.alias,
      };
    });
    return mergeAdminAndRegistry(admin, regFolders, rootGroupId);
  }, [adminSubgroups, regFolders, rootGroupId]);

  return {
    folders,
    loading: adminLoading || regLoading,
    error,
  };
}
