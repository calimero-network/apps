// Workspace folder tree merge logic — merges admin-API subgroup
// entries (source of truth for tree shape, aliases, and
// subgroup_visibility per core PR #2261) with registry FolderDto
// entries (source of truth for color + context binding + parent_id
// index).
//
// Originally also exported a `useWorkspaceTree` hook that wrapped
// `mergeAdminAndRegistry` with reactive fetching, but it was deleted
// when `useDriveWorkspace` was rewritten to inline the fetch logic.
// Only the pure merge function and shared types remain — they're
// imported by `useDriveWorkspace`, the merge unit tests, and the
// FolderTreeItem UI component.
//
// Admin subgroup entries use `{ groupId, name? }` (per mero-js's
// SubgroupEntry type — `alias` was renamed to `name` in core #2338).
// Registry entries use `{ id, parent_id, … }` (per the generated
// FolderDto, which still carries `alias`). The merge reconciles the
// two shapes.

export interface AdminSubgroup {
  groupId: string;
  parent_id: string | null;
  name?: string;
}

export interface RegistryFolderShape {
  id: string;
  parent_id: string | null;
  color: string | null;
  /** Legacy registry-side alias mirror. No longer written (folder
   *  names come from core group metadata's `name` since #2338) but
   *  still read as a back-compat fallback for folders created before
   *  the mirror was retired. Null / undefined otherwise. */
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
// side subgroups contribute `name` (human-readable name) and
// `subgroup_visibility` (Open vs Restricted, per core PR #2261).
// Iterate the registry list so that folders show up even when
// mero-js's listSubgroups is broken (it expects a `{data}` wrapper
// but core returns `{subgroups}` — the folder body resolves to
// undefined and admin comes back empty). The display name falls back
// to the legacy registry `alias` mirror and finally a shortened id
// so the folder still renders and is clickable with `admin` empty.
// Visibility falls back to undefined while the per-folder
// getGroupInfo fetch is in flight.
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
      // Preference order: admin-API `name` (authoritative — core
      // group metadata, visible to all namespace members on list rows
      // since #2338) → legacy registry `alias` mirror (back-compat for
      // folders created before the mirror was retired) → truncated id
      // stub (last-resort fallback).
      const alias =
        a?.name ?? r.alias ?? `folder-${r.id.slice(0, 8)}`;
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

