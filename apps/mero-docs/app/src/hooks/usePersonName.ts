// A member named in running text: "You", else their display name, never a key.

import { useCallback } from 'react';
import { UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';
import { useDriveWorkspace } from './useDriveWorkspace';
import { useMemberDisplayName } from './useMemberDisplayName';

export const SELF_LABEL = 'You';

/** Names members from the workspace list; the `focus` member's own metadata name wins, as in MemberLabel. */
export function usePersonName(focus?: string | null): (id: string) => string {
  const { namespaceId, selfIdentity, namespaceMemberNames } =
    useDriveWorkspace();
  const { name: focusName } = useMemberDisplayName(namespaceId, focus);
  return useCallback(
    (id: string) => {
      if (id === selfIdentity) return SELF_LABEL;
      return (
        (id === focus && focusName) ||
        namespaceMemberNames[id] ||
        UNNAMED_MEMBER_LABEL
      );
    },
    [selfIdentity, focus, focusName, namespaceMemberNames],
  );
}
