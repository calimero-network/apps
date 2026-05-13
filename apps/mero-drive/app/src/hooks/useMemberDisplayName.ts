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

/** Display names are stored in core's `MetadataRecord.name` which has no
 *  server-side max length, so we set our own to match the typical
 *  username affordance. The HTML input also enforces this with
 *  `maxLength={64}`; this is the programmatic backstop. */
export const MAX_DISPLAY_NAME_LEN = 64;

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
      if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
        throw new Error(
          `display name must be ${MAX_DISPLAY_NAME_LEN} characters or fewer`,
        );
      }
      if (!namespaceId) throw new Error('namespaceId required');
      if (!selfIdentity) throw new Error('self identity not resolved');
      // setName is a *self*-only operation by contract. Callers must bind
      // the hook to selfIdentity if they want to write. Avoids the
      // refetch-vs-write mismatch where the hook is bound to memberId=X
      // but we write to selfIdentity — refetch() would refresh X's
      // metadata, leaving the caller's own state stale until next mount.
      if (memberId && memberId !== selfIdentity) {
        throw new Error(
          'setName is self-only — bind useMemberDisplayName to selfIdentity to write',
        );
      }
      await setMemberMetadata(namespaceId, selfIdentity, {
        name: trimmed,
        data: {},
      });
      await refetch();
    },
    [namespaceId, memberId, selfIdentity, setMemberMetadata, refetch],
  );

  return { name, loading, error, setName };
}
