// Workspace folder tree merge logic — merges admin-API subgroup
// entries (source of truth for tree shape, aliases, and
// subgroup_visibility) with registry FolderDto
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
// SubgroupEntry type). Registry entries use `{ id, parent_id, … }` (per the
// generated FolderDto, which also carries `alias`). The merge reconciles the
// two shapes.

import { folderLabel } from '@/lib/folderLabel';

export interface AdminSubgroup {
  groupId: string;
  parent_id: string | null;
  name?: string;
}

export interface RegistryFolderShape {
  id: string;
  parent_id: string | null;
  color: string | null;
  /** Copy of the group name, readable by members who can't read a restricted
   *  folder's metadata; null for folders created before it was written. */
  alias?: string | null;
  /** The folder's docs context; null until its binding reaches this node. */
  context_id?: string | null;
}

export interface MergedFolder {
  id: string;
  parent_id: string | null;
  alias: string;
  /** Sourced from core's GroupInfo.subgroupVisibility.
   *  `undefined` while the per-folder fetch is still in flight. */
  visibility: 'Open' | 'Restricted' | undefined;
  color: string | null;
}

// Iterates the registry (which folders exist) so a folder still renders when
// the admin side, which adds the name and visibility, comes back empty.
export function mergeAdminAndRegistry(
  admin: AdminSubgroup[],
  registry: RegistryFolderShape[],
  rootId: string,
  visibilityById?: Map<string, 'Open' | 'Restricted'>,
  // Folder ids the current caller is NOT allowed to see (their
  // per-folder getGroupInfo came back access-denied — core rejects
  // non-members of a restricted subgroup). Restricted folders the
  // caller isn't a member of land here and are dropped from the tree
  // entirely, so they never appear in the rail.
  hiddenIds?: Set<string>,
): { folders: MergedFolder[] } {
  const adminById = new Map(admin.map((a) => [a.groupId, a]));
  const folders: MergedFolder[] = registry
    .filter((r) => r.id !== rootId && !(hiddenIds?.has(r.id) ?? false))
    .map((r) => {
      const a = adminById.get(r.id);
      // Group metadata name first, then the registry copy, then "Untitled folder".
      const alias = folderLabel(a?.name || r.alias);
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

