// Folder-scope permissions - all of them from core:
//
//  1. The caller's core capability bitmask on the folder's subgroup
//     (`useMemberCaps`) - the same `MemberCapabilities` layout the
//     backend enforces via `is_group_admin_or_has_capability`. Drives the
//     folder-admin affordances: rename / visibility / delete / invite /
//     manage-members. `isAdmin` (core group-admin role) bypasses it.
//
//  2. The documents `Role` (Viewer / Editor / Manager), derived from the
//     same read (`documentRoleOf`): core ReadOnly is a Viewer, the folder
//     Manager caps are a Manager, anyone else edits. Core ReadOnly is also
//     what refuses a Viewer's writes, so the two cannot disagree. Nothing
//     about a folder's roles is kept in the namespace-wide registry, which
//     every workspace member replicates - a Restricted folder's roles stay
//     with the members who can read it.
//
//  3. Registry ownership/managers - only `permissionsNeedOwner`: folder
//     roles are core roles and caps, which only the folder's admin may
//     write, so `canManagePermissions` is `isAdmin`. Read from
//     `useDriveWorkspace().registryAdmin` (fetched ONCE for the whole tree).
//
// Open subgroups inherit membership from the parent namespace via the
// server's parent-walk, so a namespace member with
// `CAN_JOIN_OPEN_SUBGROUPS` (default-on) gets real caps from the admin API
// directly - no app-layer fallback needed.
//
// `isMember` (folder subgroup membership) implies read access. Editing docs
// is `canEditDocs`, deliberately CONSERVATIVE: false while the caps load, on
// a caps error, and for core ReadOnly - core refuses those writes, so the UI
// must never offer one.

import { CAPABILITIES, hasCap } from '../constants/config';
import { documentRoleOf, type Role } from '../lib/roles';
import { useMemberCaps } from './useMemberCaps';
import { useDriveWorkspace } from './useDriveWorkspace';
import { isGroupNotOnNode, isMemberGone } from '@/utils/accessDenied';

export interface FolderPermissions {
  /** Member of the folder subgroup at all - true only when the caps
   *  fetch *succeeded* (`caps !== null && error === null`). A genuine
   *  member with the empty bitmask still has `caps === 0, error === null`
   *  so they count; a failed fetch (`caps === 0, error !== null`) does
   *  NOT, so consumers don't render write affordances on error. */
  isMember: boolean;
  /** Create a *sub*folder - note core only allows subgroups directly
   *  under the namespace root, so this is effectively a namespace-scope
   *  grant; kept here for the folder context menu's "new subfolder". */
  canCreateSubfolder: boolean;
  canRename: boolean; // isAdmin || CAN_MANAGE_METADATA
  canManageVisibility: boolean; // CAN_MANAGE_VISIBILITY
  /** Delete THIS folder: a core group-admin, or a member holding
   *  `CAN_DELETE_SUBGROUP` (the folder Manager grant). */
  canDelete: boolean;
  canInviteMembers: boolean; // CAN_INVITE_MEMBERS
  canManageMembers: boolean; // MANAGE_MEMBERS
  /** Edit or comment on documents in this folder: `isAdmin`, or a folder
   *  member core does not hold ReadOnly. False while the caps load and on a
   *  caps error, so autosave can't persist a would-be Viewer's edits. Pair
   *  with `roleLoading` for a "checking permissions" hint. */
  canEditDocs: boolean;
  /** Change per-folder roles: `isAdmin` only, since core takes a folder's
   *  role and caps changes from its admin alone. */
  canManagePermissions: boolean;
  /** A registry owner or manager who is not this folder's admin: the panel
   *  says why the roles are fixed for them. */
  permissionsNeedOwner: boolean;
  /** The caller's documents role on this folder, from core; `null` while
   *  the caps load or on a caps error. */
  role: Role | null;
  /** True while the caps read that decides `role` is in flight. */
  roleLoading: boolean;
  /** The caps read's error, when it failed. While set, editing is disabled
   *  (we can't confirm the caller isn't a Viewer). */
  roleError: Error | null;
  /** Aggregate: any folder-admin-ish power. Used to show the sharing
   *  panel / context-menu admin section. */
  canManageGroup: boolean;
  loading: boolean;
  /** Non-null when the underlying caps fetch failed. UI should show
   *  a retry affordance rather than treating loading:false + all-
   *  booleans-false as legitimate "no permissions." */
  error: Error | null;
  /** `error` is the caps probe's non-member refusal, not a fault. */
  denied: boolean;
  /** Core no longer finds the caller in the folder: removed from an Open one. */
  removed: boolean;
  /** This node has no record of the folder's group yet - its governance has
   *  not synced here. Not a refusal: the folder appears once it does. */
  notSynced: boolean;
  /** Re-run the membership probe. Use after an action that may have
   *  changed the caller's membership server-side (e.g. the join-via-
   *  inheritance call on the Open-folder card) - useMemberCaps's deps
   *  don't change on those flows, so the cached "not a member" stays
   *  unless something forces a re-fetch. */
  refetch: () => void;
}

export function useFolderPermissions(
  namespaceId: string,
  folderId: string,
): FolderPermissions {
  const {
    caps,
    isAdmin,
    isReadOnly,
    error,
    denied,
    refetch: refetchCaps,
  } = useMemberCaps(
    namespaceId,
    folderId,
  );
  // The documents role is core's: its ReadOnly role and the folder caps.
  const role = error ? null : documentRoleOf(isAdmin, isReadOnly, caps);
  const roleLoading = caps === null;
  const roleError = error;
  const { isOwnerOrManager } = useDriveWorkspace().registryAdmin;

  const has = (bit: number) => isAdmin || (caps !== null && hasCap(caps, bit));
  const canRename = has(CAPABILITIES.CAN_MANAGE_METADATA);
  const canManageVisibility = has(CAPABILITIES.CAN_MANAGE_VISIBILITY);
  const hasDeleteCap = has(CAPABILITIES.CAN_DELETE_SUBGROUP);
  const canInviteMembers = has(CAPABILITIES.CAN_INVITE_MEMBERS);
  const canManageMembers = has(CAPABILITIES.MANAGE_MEMBERS);
  const canCreateSubfolder = has(CAPABILITIES.CAN_CREATE_SUBGROUP);

  const isMember = caps !== null && error === null;

  // A core admin can always delete; otherwise the member needs the delete cap,
  // which only the folder Manager grant carries.
  const canDelete = isAdmin || hasDeleteCap;

  // Doc editing - CONSERVATIVE. Core refuses a ReadOnly member's writes,
  // so an offered edit could only be typed and then lost: only an admin, or a
  // member core does not hold ReadOnly.
  const canEditDocs = isAdmin || (isMember && !isReadOnly);

  const canManagePermissions = isAdmin;

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
    permissionsNeedOwner: isOwnerOrManager && !isAdmin,
    role,
    roleLoading,
    roleError,
    // Aggregate "folder-admin-ish" power - the union of the per-cap
    // grants. Used to reveal the sharing-panel admin section / context-
    // menu admin items. (Mirrors `canManageGroup` in namespace perms;
    // deliberately excludes `canCreateSubfolder`, which is a namespace-
    // scope grant, not a folder-admin signal.) Pure capability-bit
    // aggregate - `canManagePermissions` (registry owner/manager) is
    // an orthogonal concept gated separately by the sharing panel, so
    // it is NOT folded in here: a registry-only manager with zero
    // folder caps would otherwise see an admin context-menu trigger
    // (the ⋯ button) with an empty body underneath.
    canManageGroup:
      canRename ||
      canManageVisibility ||
      hasDeleteCap ||
      canInviteMembers ||
      canManageMembers,
    loading: caps === null,
    error,
    denied,
    removed: isMemberGone(error),
    notSynced: isGroupNotOnNode(error),
    refetch: refetchCaps,
  };
}
