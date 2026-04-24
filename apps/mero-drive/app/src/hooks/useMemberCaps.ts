// Resolve the caller's capability bitmask for a given group. Thin
// wrapper over mero-react's useGroupCapabilities, bridging its
// `{ capabilities, loading, error }` shape to this app's legacy
// `{ caps, error }` contract so existing consumers (useFolderPermissions,
// useNamespacePermissions, their tests) don't need to change.
//
// State convention (unchanged from the previous adminRequest-based
// implementation):
//   - `caps = null, error = null` → loading (bootstrap or in-flight).
//   - `caps = 0,    error = null` → resolved with zero bits (legit
//     member-with-no-caps).
//   - `caps > 0,    error = null` → actual bitmask.
//   - `caps = 0,    error = Error` → fetch failed; callers show a
//     retry affordance rather than silently rendering "all denied".

import { useGroupCapabilities } from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';

export interface MemberCapsState {
  caps: number | null;
  error: Error | null;
}

// `namespaceId` is retained in the signature (unused) so consumers
// don't need to change imports. Identity comes from the active
// workspace via useDriveWorkspace — every call site already operates
// on the currently-selected namespace.
export function useMemberCaps(
  _namespaceId: string,
  groupId: string,
): MemberCapsState {
  const { selfIdentity } = useDriveWorkspace();
  const memberId = selfIdentity ?? '';
  const { capabilities, loading, error } = useGroupCapabilities(
    groupId || undefined,
    memberId || undefined,
  );

  if (error) return { caps: 0, error };
  if (loading || !groupId || !memberId) return { caps: null, error: null };
  return { caps: capabilities ?? 0, error: null };
}
