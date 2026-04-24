// Resolve the caller's EFFECTIVE capability bitmask for a given
// group. Effective = role-OR-override.
//
// The backend uses two orthogonal fields to decide authorization
// (core/context/group_store/membership.rs:172):
//   - `role` (enum Admin / Member / ReadOnly): Admins bypass every
//     capability check.
//   - `capabilities` (u32 bitmask): per-member delegation for
//     non-admin members.
//
// `mero.admin.getMemberCapabilities` (and mero-react's
// useGroupCapabilities) returns ONLY the capability override. For an
// Admin-role member the override is typically 0 because Admins don't
// need delegated bits. If we gated UI affordances purely on that
// override, the namespace creator (who is always Admin) would see
// zero affordances — no "New folder", no "Rename", etc. — despite
// having full server-side authority.
//
// Fix: fold role into the bitmask client-side. If `role === 'Admin'`
// we report caps = 63 (all six bits set) so every permission hook
// renders the full set of affordances. This matches the server's
// short-circuit logic exactly: role=Admin → "yes" regardless of cap
// bit.
//
// State convention:
//   - `caps = null, error = null` → loading.
//   - `caps = 0,    error = null` → non-admin with no override bits.
//   - `caps > 0,    error = null` → actual bitmask (or 63 for Admins).
//   - `caps = 0,    error = Error` → fetch failed; callers show a
//     retry affordance rather than silently rendering "all denied".

import {
  useGroupCapabilities,
  useGroupMembers,
} from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';

const ALL_CAPS_BITMASK = 0b111111; // READ|WRITE|CREATE_GROUP|MANAGE_GROUP|INVITE_MEMBERS|MANAGE_MEMBERS

export interface MemberCapsState {
  caps: number | null;
  error: Error | null;
}

// `namespaceId` is retained in the signature (unused at this layer)
// so consumers don't need to change imports. Identity comes from
// the active workspace via useDriveWorkspace — every call site
// operates on the currently-selected namespace.
export function useMemberCaps(
  _namespaceId: string,
  groupId: string,
): MemberCapsState {
  const { selfIdentity } = useDriveWorkspace();
  const memberId = selfIdentity ?? '';

  // Fetch both the role (via group members) and the capability
  // override. Either can be the authoritative source depending on
  // the member's tier.
  const { members, loading: membersLoading } = useGroupMembers(
    groupId || undefined,
  );
  const {
    capabilities,
    loading: capsLoading,
    error,
  } = useGroupCapabilities(groupId || undefined, memberId || undefined);

  if (error) return { caps: 0, error };
  if (capsLoading || membersLoading || !groupId || !memberId) {
    return { caps: null, error: null };
  }

  // If the caller is Admin on this group, grant every bit. Matches
  // the server-side is_group_admin_or_has_capability short-circuit.
  const me = members.find((m) => m.identity === memberId);
  if (me?.role === 'Admin') {
    return { caps: ALL_CAPS_BITMASK, error: null };
  }

  return { caps: capabilities ?? 0, error: null };
}
