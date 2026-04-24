// Resolve the caller's EFFECTIVE capability bitmask for a given
// group. Effective = role-OR-override.
//
// Background — the server uses two orthogonal fields for authz
// (core/context/group_store/membership.rs:172):
//   - `role` (Admin | Member | ReadOnly): Admins bypass every cap
//     check.
//   - `capabilities` (u32 bitmask): per-member delegation for
//     non-admin members.
//
// mero-react's useGroupCapabilities returns only the capability
// override. For an Admin-role member that is typically 0, so a
// pure-caps gate hides every affordance from the namespace creator.
// We need the role too and OR it in: Admin → caps=63 (all bits).
//
// Why we DON'T use mero-react's useGroupMembers to read the role:
// mero-react 1.1.0 / mero-js 1.4.1 reads `response.data` from
// `listGroupMembers`, but core actually serializes the list under
// `response.members`. So useGroupMembers always reports members=[]
// even when the real HTTP body has entries. This is the third
// upstream bug in that stack we've worked around (after unwrap() and
// useAsyncMutation error-swallow). We call `mero.admin.listGroupMembers`
// directly and read the raw shape instead.
//
// State convention:
//   - `caps = null, error = null` → loading.
//   - `caps = 0,    error = null` → non-admin with no override bits.
//   - `caps > 0,    error = null` → actual bitmask (or 63 for Admins).
//   - `caps = 0,    error = Error` → fetch failed; callers show a
//     retry affordance rather than silently rendering "all denied".

import { useEffect, useState } from 'react';
import { useGroupCapabilities, useMero } from '@calimero-network/mero-react';
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
  const { mero } = useMero();
  const { selfIdentity } = useDriveWorkspace();
  const memberId = selfIdentity ?? '';

  const {
    capabilities,
    loading: capsLoading,
    error: capsError,
  } = useGroupCapabilities(groupId || undefined, memberId || undefined);

  // Parallel direct-HTTP read of the members list to check our role.
  // Not going through useGroupMembers because of the mero-react
  // `response.data` bug documented in the file header.
  const [role, setRole] = useState<string | null>(null);
  const [rolesLoading, setRolesLoading] = useState<boolean>(false);
  const [rolesError, setRolesError] = useState<Error | null>(null);

  useEffect(() => {
    if (!mero || !groupId || !memberId) {
      setRole(null);
      setRolesLoading(false);
      setRolesError(null);
      return;
    }
    let alive = true;
    setRolesLoading(true);
    setRolesError(null);
    mero.admin
      .listGroupMembers(groupId)
      .then((raw) => {
        if (!alive) return;
        // Cast through unknown because the DTS promises
        // `{ data, selfIdentity }` but the wire shape is
        // `{ members, selfIdentity }`. When mero-js ships the fix
        // we can drop the cast.
        const real = raw as unknown as {
          members?: Array<{ identity: string; role?: string }>;
        };
        const me = (real.members ?? []).find((m) => m.identity === memberId);
        setRole(me?.role ?? null);
        setRolesLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setRolesError(err instanceof Error ? err : new Error(String(err)));
        setRolesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mero, groupId, memberId]);

  const error = capsError ?? rolesError;
  if (error) return { caps: 0, error };
  if (capsLoading || rolesLoading || !groupId || !memberId) {
    return { caps: null, error: null };
  }

  // Admin short-circuit — mirrors the server's
  // `is_group_admin_or_has_capability` logic.
  if (role === 'Admin') {
    return { caps: ALL_CAPS_BITMASK, error: null };
  }

  return { caps: capabilities ?? 0, error: null };
}
