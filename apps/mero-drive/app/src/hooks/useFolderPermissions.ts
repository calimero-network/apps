// Folder-scope permissions — derived from the caller's capability
// bitmask on the folder's subgroup. Used by FolderContextMenu,
// NewFolderButton, FolderVisibilityToggle, and the sharing panel to
// gate per-folder affordances.
//
// Bit checks reference mero-js's `CAPABILITIES` (re-exported via
// `constants/config.ts`) — core's `MemberCapabilities`, the same
// layout the backend enforces via `is_group_admin_or_has_capability`
// (core/context/group_store/membership.rs). `isAdmin` (core group-admin
// role) always bypasses the bitmask.
//
// As of core PR #2261, Open subgroups inherit membership from the
// parent namespace via the server's parent-walk, so a namespace
// member with `CAN_JOIN_OPEN_SUBGROUPS` (default-on) gets real caps
// from the admin API directly — no app-layer fallback needed.
//
// Note: folder *membership alone* implies read access (the `isMember`
// flag); the per-(folder,member) "viewer vs editor on docs" concept is
// the registry `Role`, not a cap bit.
// TODO(phase-c-part-3): canEditDocs from registry Role

import { CAPABILITIES, hasCap } from '../constants/config';
import { useMemberCaps } from './useMemberCaps';

export interface FolderPermissions {
  /** Member of the folder subgroup at all (caps fetch succeeded). */
  isMember: boolean;
  /** Create a *sub*folder — note core only allows subgroups directly
   *  under the namespace root, so this is effectively a namespace-scope
   *  grant; kept here for the folder context menu's "new subfolder". */
  canCreateSubfolder: boolean;
  canRename: boolean; // CAN_MANAGE_METADATA
  canManageVisibility: boolean; // CAN_MANAGE_VISIBILITY
  canDelete: boolean; // CAN_DELETE_SUBGROUP
  canInviteMembers: boolean; // CAN_INVITE_MEMBERS
  canManageMembers: boolean; // MANAGE_MEMBERS
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
  const has = (bit: number) => isAdmin || (caps !== null && hasCap(caps, bit));
  const canRename = has(CAPABILITIES.CAN_MANAGE_METADATA);
  const canManageVisibility = has(CAPABILITIES.CAN_MANAGE_VISIBILITY);
  const canDelete = has(CAPABILITIES.CAN_DELETE_SUBGROUP);
  const canInviteMembers = has(CAPABILITIES.CAN_INVITE_MEMBERS);
  const canManageMembers = has(CAPABILITIES.MANAGE_MEMBERS);
  const canCreateSubfolder = has(CAPABILITIES.CAN_CREATE_SUBGROUP);
  return {
    isMember: caps !== null,
    canCreateSubfolder,
    canRename,
    canManageVisibility,
    canDelete,
    canInviteMembers,
    canManageMembers,
    canManageGroup:
      canRename ||
      canManageVisibility ||
      canDelete ||
      canInviteMembers ||
      canManageMembers,
    loading: caps === null,
    error,
  };
}
