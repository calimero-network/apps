// Folder-scope permissions — derived from TWO orthogonal sources:
//
//  1. The caller's core capability bitmask on the folder's subgroup
//     (`useMemberCaps`) — the same `MemberCapabilities` layout the
//     backend enforces via `is_group_admin_or_has_capability`
//     (core/context/group_store/membership.rs). Drives the
//     folder-admin affordances: rename / visibility / delete / invite /
//     manage-members. `isAdmin` (core group-admin role) bypasses it.
//
//  2. The Registry per-(folder, member) `Role` (`useFolderRole`) — the
//     "Viewer vs Editor vs Manager on documents" concept that does NOT
//     exist in the core bitmask (design spec §5.3 / §5.5). Drives
//     `canEditDocs`. An absent role row resolves to `Editor` (the WASM
//     default), so a brand-new member can edit by default; an explicit
//     `Viewer` downgrades them to read-only.
//
//  3. Registry ownership/managers (`useRegistryAdmin`) — gates
//     `canManagePermissions` (who may change folder roles / see the
//     sharing-panel admin section). Fail-closed: until someone
//     `claim_owner`s the registry, nobody is an owner/manager.
//
// As of core PR #2261, Open subgroups inherit membership from the
// parent namespace via the server's parent-walk, so a namespace member
// with `CAN_JOIN_OPEN_SUBGROUPS` (default-on) gets real caps from the
// admin API directly — no app-layer fallback needed.
//
// `isMember` (folder subgroup membership) implies read access. Editing
// docs is `canEditDocs` (cap-membership + a non-Viewer registry Role).

import { CAPABILITIES, hasCap } from '../constants/config';
import type { Role } from '../api/registry/RegistryClient';
import { useMemberCaps } from './useMemberCaps';
import { useFolderRole } from './useFolderRole';
import { useRegistryAdmin } from './useRegistryAdmin';

export interface FolderPermissions {
  /** Member of the folder subgroup at all — true only when the caps
   *  fetch *succeeded* (`caps !== null && error === null`). A genuine
   *  member with the empty bitmask still has `caps === 0, error === null`
   *  so they count; a failed fetch (`caps === 0, error !== null`) does
   *  NOT, so consumers don't render write affordances on error. */
  isMember: boolean;
  /** Create a *sub*folder — note core only allows subgroups directly
   *  under the namespace root, so this is effectively a namespace-scope
   *  grant; kept here for the folder context menu's "new subfolder". */
  canCreateSubfolder: boolean;
  canRename: boolean; // isAdmin || CAN_MANAGE_METADATA
  canManageVisibility: boolean; // CAN_MANAGE_VISIBILITY
  /** Delete THIS folder. Per spec §5.5: a core group-admin always, or
   *  a member who both holds `CAN_DELETE_SUBGROUP` *and* has the
   *  registry `Manager` role on the folder. */
  canDelete: boolean;
  canInviteMembers: boolean; // CAN_INVITE_MEMBERS
  canManageMembers: boolean; // MANAGE_MEMBERS
  /** Edit documents in this folder: `isAdmin`, or a folder member whose
   *  registry `Role` is not `Viewer`. While the role is still loading
   *  this is *optimistic-true for members* (so the editor doesn't flash
   *  read-only) — pair with `roleLoading` if you want a "checking
   *  permissions" hint. */
  canEditDocs: boolean;
  /** Change per-folder roles / see the sharing-panel admin section:
   *  `isAdmin`, or the registry owner/manager. */
  canManagePermissions: boolean;
  /** The caller's registry `Role` on this folder; `null` while loading.
   *  `'Editor'` once loaded if no explicit row exists (WASM default). */
  role: Role | null;
  /** True while the registry Role read is in flight. */
  roleLoading: boolean;
  /** Aggregate: any folder-admin-ish power. Used to show the sharing
   *  panel / context-menu admin section. */
  canManageGroup: boolean;
  loading: boolean;
  /** Non-null when the underlying caps fetch failed. UI should show
   *  a retry affordance rather than treating loading:false + all-
   *  booleans-false as legitimate "no permissions." */
  error: Error | null;
}

export function useFolderPermissions(
  namespaceId: string,
  folderId: string,
): FolderPermissions {
  const { caps, isAdmin, error } = useMemberCaps(namespaceId, folderId);
  const { role, loading: roleLoading } = useFolderRole(folderId || null);
  const { isOwnerOrManager } = useRegistryAdmin();

  const has = (bit: number) => isAdmin || (caps !== null && hasCap(caps, bit));
  const canRename = has(CAPABILITIES.CAN_MANAGE_METADATA);
  const canManageVisibility = has(CAPABILITIES.CAN_MANAGE_VISIBILITY);
  const hasDeleteCap = has(CAPABILITIES.CAN_DELETE_SUBGROUP);
  const canInviteMembers = has(CAPABILITIES.CAN_INVITE_MEMBERS);
  const canManageMembers = has(CAPABILITIES.MANAGE_MEMBERS);
  const canCreateSubfolder = has(CAPABILITIES.CAN_CREATE_SUBGROUP);

  const isMember = caps !== null && error === null;

  // Per spec §5.5: a core admin can always delete; otherwise the
  // member needs BOTH the delete cap and the registry Manager role.
  const canDelete = isAdmin || (hasDeleteCap && role === 'Manager');

  // Doc editing == folder membership + a non-Viewer registry role.
  // While the role read is in flight, stay optimistic for members so
  // the editor doesn't flash read-only then flip back to writable;
  // a definitive `'Viewer'` is the only thing that disables it.
  const canEditDocs =
    isAdmin || (isMember && role !== 'Viewer');

  const canManagePermissions = isAdmin || isOwnerOrManager;

  return {
    isMember,
    canCreateSubfolder,
    canRename,
    canManageVisibility,
    canDelete,
    canInviteMembers,
    canManageMembers,
    canEditDocs,
    canManagePermissions,
    role,
    roleLoading,
    // Aggregate "folder-admin-ish" power — the union of the per-cap
    // grants. Used to reveal the sharing-panel admin section / context-
    // menu admin items. (Mirrors `canManageGroup` in namespace perms;
    // deliberately excludes `canCreateSubfolder`, which is a namespace-
    // scope grant, not a folder-admin signal.)
    canManageGroup:
      canRename ||
      canManageVisibility ||
      hasDeleteCap ||
      canInviteMembers ||
      canManageMembers ||
      canManagePermissions,
    loading: caps === null,
    error,
  };
}
