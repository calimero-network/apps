// Admin-only path for renaming a *different* member's display name.
// Pair this with useMemberDisplayName which is self-only-by-contract;
// this hook is the explicit other-member surface, gated on the caller
// holding CAN_MANAGE_METADATA or being a core group-admin. The server
// validates the same authz, so this is also defense-in-depth.

import { useCallback } from 'react';
import { useSetMemberMetadata } from '@calimero-network/mero-react';
import { CAPABILITIES, hasCap } from '../constants/config';
import { useDriveWorkspace } from './useDriveWorkspace';
import { useMemberCaps } from './useMemberCaps';
import { MAX_DISPLAY_NAME_LEN } from './useMemberDisplayName';

export { MAX_DISPLAY_NAME_LEN } from './useMemberDisplayName';

export interface AdminRenameMember {
  /** True iff the caller is allowed to rename `memberId` (admin role or
   *  CAN_MANAGE_METADATA on the namespace root). */
  canRename: boolean;
  /** Set `memberId`'s display name. Throws when:
   *    - the trimmed name is empty,
   *    - the name exceeds MAX_DISPLAY_NAME_LEN,
   *    - the caller lacks permission,
   *    - the target is the caller (use useMemberDisplayName for self-edits). */
  renameTo: (name: string) => Promise<void>;
}

export function useAdminRenameMember(
  namespaceId: string | null | undefined,
  memberId: string | null | undefined,
): AdminRenameMember {
  const { selfIdentity, rootGroupId } = useDriveWorkspace();
  const { caps, isAdmin } = useMemberCaps(namespaceId ?? '', rootGroupId ?? '');
  const { setMemberMetadata } = useSetMemberMetadata();

  const canRename =
    isAdmin ||
    (caps !== null && hasCap(caps, CAPABILITIES.CAN_MANAGE_METADATA));

  const renameTo = useCallback(
    async (next: string) => {
      // Authorization first — never let a missing arg / out-of-window
      // state mask a permission failure with a friendlier error.
      if (!canRename) {
        throw new Error('no permission to rename other members');
      }
      if (selfIdentity && memberId === selfIdentity) {
        throw new Error(
          'renameTo refuses self — use useMemberDisplayName.setName for self edits',
        );
      }
      const trimmed = next.trim();
      if (!trimmed) throw new Error('display name cannot be empty');
      if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
        throw new Error(
          `display name must be ${MAX_DISPLAY_NAME_LEN} characters or fewer`,
        );
      }
      if (!namespaceId) throw new Error('namespaceId required');
      if (!memberId) throw new Error('memberId required');
      await setMemberMetadata(namespaceId, memberId, {
        name: trimmed,
        data: {},
      });
    },
    [namespaceId, memberId, selfIdentity, canRename, setMemberMetadata],
  );

  return { canRename, renameTo };
}
