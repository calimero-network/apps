// Transitional shim over useDriveWorkspace().selfIdentity.
//
// The previous implementation owned its own localStorage cache + a
// direct GET /admin-api/namespaces/:id/identity call (to work around
// a mero-js unwrap bug). Phase 3 moved identity resolution into
// useDriveWorkspace, which reads it from mero-react's
// `useGroupMembers(ns).selfIdentity` — the canonical primitive.
//
// This file stays only so `useMemberCaps` / `useDocs` / tests don't
// need to be rewritten in the same commit. Phase 5 can inline the
// identity read at each caller and delete this file.
//
// The `namespaceId` argument is ignored — useDriveWorkspace already
// tracks the active namespace. If a caller ever needs identity for a
// DIFFERENT namespace than the currently-selected one, they'd need
// the real per-namespace call. No current caller does (all ask for
// the active workspace's identity).

import { useDriveWorkspace } from './useDriveWorkspace';

export interface SelfIdentityState {
  identity: string | null;
  loading: boolean;
  error: Error | null;
}

/** Deprecated. Prefer `useDriveWorkspace().selfIdentity`. */
export function useSelfIdentity(_namespaceId: string | null): SelfIdentityState {
  const ws = useDriveWorkspace();
  return {
    identity: ws.selfIdentity,
    loading: ws.loading && !ws.selfIdentity,
    error: ws.error,
  };
}

/** No-op. Identity cache is owned by useGroupMembers in mero-react now. */
export function clearIdentityCache(): void {
  // Intentionally empty. The old per-namespace localStorage cache
  // (`mero-drive:selfId:*`) was removed in Phase 3. Kept as an
  // export so App.tsx's logout branch (if it still references it)
  // doesn't explode before Phase 5 cleans up.
}
