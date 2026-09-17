// Transitional shim over useDriveWorkspace().selfIdentity.
//
// The previous implementation owned its own localStorage cache + a
// direct GET /admin-api/namespaces/:id/identity call (to work around
// a mero-js unwrap bug). Identity resolution now lives in
// useDriveWorkspace, which reads it from mero-react's
// `useNodeIdentity().identity.accountId` — the ACCOUNT, which is what
// `listGroupMembers` rows are keyed by and what every member-addressing
// call takes.
//
// This file stays only so `useMemberCaps` / `useDocs` / tests don't
// need to be rewritten in the same commit. Phase 5 can inline the
// identity read at each caller and delete this file.
//
// The `namespaceId` argument is ignored, and now harmlessly so: an
// account is per-NODE, not per-namespace, so the same value answers for
// every namespace this node has joined.

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

/** No-op. Identity is owned by useNodeIdentity in mero-react now. */
export function clearIdentityCache(): void {
  // Intentionally empty. The old per-namespace localStorage cache
  // (`mero-drive:selfId:*`) is long gone. Kept as an export so any
  // remaining logout branch referencing it doesn't explode.
}
