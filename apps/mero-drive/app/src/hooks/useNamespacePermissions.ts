// Namespace-scope permissions — derived from the caller's capability
// bitmask on the namespace's root group. Consumed by the namespace
// switcher / namespace-level admin panels to gate "create subgroup",
// "manage namespace", "manage members" affordances.

import { CAP } from '../constants/config';
import { useMemberCaps } from './useMemberCaps';

export interface NamespacePermissions {
  canCreateSubgroup: boolean;
  canManageNamespace: boolean;
  canManageNamespaceMembers: boolean;
  canInviteMembers: boolean;
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
  const { caps, error } = useMemberCaps(namespaceId, rootGroupId);
  const has = (bit: number) => caps !== null && (caps & bit) === bit;
  return {
    canCreateSubgroup: has(CAP.CREATE_GROUP),
    canManageNamespace: has(CAP.MANAGE_GROUP),
    canManageNamespaceMembers: has(CAP.MANAGE_MEMBERS),
    canInviteMembers: has(CAP.INVITE_MEMBERS),
    loading: caps === null,
    error,
  };
}
