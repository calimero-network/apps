// Per-(namespace, member) display name backed by core's setMemberMetadata
// (PR #2338). Returns null when unset — callers should render a truncated
// pubkey as the visual fallback (see <MemberLabel>).
//
// Self-edit is the only mutation surface this hook exposes: the writer
// methods always target `selfIdentity` and ignore the `memberId` arg, so a
// component holding a reference to `setName` cannot rename someone else
// (the server gates that on `CAN_MANAGE_METADATA` anyway, but the hook
// shouldn't even offer the API — defense-in-depth). Admin "rename any
// member" is an explicit follow-up surface, not this hook.

import { useCallback } from 'react';
import {
  useMemberMetadata,
  useSetMemberMetadata,
} from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';

export interface MemberDisplayName {
  /** Display name or null when none is set. */
  name: string | null;
  loading: boolean;
  error: Error | null;
  /** Sets the current caller's display name in this namespace. Throws if
   *  trimmed input is empty or the caller's identity isn't resolved yet.
   *  Always targets `selfIdentity` — see file header.
   *
   *  NOTE: There is no `clearName()` here. mero-js's `SetMetadataRequest`
   *  currently types `name` as `string | undefined`, which means "omit ⇒
   *  keep current name". The wire protocol supports `null ⇒ clear`, but
   *  the TS surface needs to land that as `string | null` first. Until
   *  then, "clear my display name" is a deferred surface. */
  setName: (name: string) => Promise<void>;
}

export function useMemberDisplayName(
  namespaceId: string | null | undefined,
  memberId: string | null | undefined,
): MemberDisplayName {
  const { selfIdentity } = useDriveWorkspace();
  const { metadata, loading, error, refetch } = useMemberMetadata(
    namespaceId ?? null,
    memberId ?? null,
  );
  const { setMemberMetadata } = useSetMemberMetadata();

  const name = metadata?.name ?? null;

  const setName = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (!trimmed) throw new Error('display name cannot be empty');
      if (!namespaceId) throw new Error('namespaceId required');
      if (!selfIdentity) throw new Error('self identity not resolved');
      await setMemberMetadata(namespaceId, selfIdentity, {
        name: trimmed,
        data: {},
      });
      await refetch();
    },
    [namespaceId, selfIdentity, setMemberMetadata, refetch],
  );

  return { name, loading, error, setName };
}
