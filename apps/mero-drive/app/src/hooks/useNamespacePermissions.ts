// Namespace-scope permissions — derived from the caller's capability
// bitmask on the namespace's root group. Consumed by the namespace
// switcher / namespace-level admin panels to gate "create folder",
// "manage namespace", "manage members" affordances.
//
// Bit checks reference mero-js's `CAPABILITIES` (re-exported via
// `constants/config.ts`). `isAdmin` (core group-admin role) always
// bypasses the bitmask.

import { CAPABILITIES, hasCap } from '../constants/config';
import { useMemberCaps } from './useMemberCaps';

export interface NamespacePermissions {
  /** Create a top-level folder (core: CAN_CREATE_SUBGROUP, root-only). */
  canCreateFolder: boolean;
  /** Join Open folders (default-on for new members). */
  canJoinOpenFolders: boolean;
  canCreateContext: boolean; // CAN_CREATE_CONTEXT — needed to create a folder's docs ctx
  canManageVisibility: boolean; // CAN_MANAGE_VISIBILITY
  canManageMetadata: boolean; // CAN_MANAGE_METADATA (rename folders / set display names)
  canInviteMembers: boolean; // CAN_INVITE_MEMBERS
  canManageMembers: boolean; // MANAGE_MEMBERS
  /** Aggregate admin-ish: show namespace settings / members panels. */
  canManageNamespace: boolean;
  loading: boolean;
  /** Non-null when the underlying caps fetch failed. UI should show
   *  a retry affordance rather than treating loading:false + all-
   *  booleans-false as legitimate "no permissions." */
  error: Error | null;
}

export function useNamespacePermissions(
  namespaceId: string,
  rootGroupId: string,
): NamespacePermissions {
  const { caps, isAdmin, error } = useMemberCaps(namespaceId, rootGroupId);
  const has = (bit: number) => isAdmin || (caps !== null && hasCap(caps, bit));
  const canManageMembers = has(CAPABILITIES.MANAGE_MEMBERS);
  const canManageMetadata = has(CAPABILITIES.CAN_MANAGE_METADATA);
  const canManageVisibility = has(CAPABILITIES.CAN_MANAGE_VISIBILITY);
  const canInviteMembers = has(CAPABILITIES.CAN_INVITE_MEMBERS);
  return {
    canCreateFolder: has(CAPABILITIES.CAN_CREATE_SUBGROUP),
    canJoinOpenFolders: has(CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS),
    canCreateContext: has(CAPABILITIES.CAN_CREATE_CONTEXT),
    canManageVisibility,
    canManageMetadata,
    canInviteMembers,
    canManageMembers,
    canManageNamespace:
      canManageMembers ||
      canManageMetadata ||
      canManageVisibility ||
      canInviteMembers,
    loading: caps === null,
    error,
  };
}
