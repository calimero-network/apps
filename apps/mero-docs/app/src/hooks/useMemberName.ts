// A member's name as <MemberLabel> shows it: their own metadata name first, else
// the workspace roster's. `settled` stays false while an unnamed member's read runs.

import { useDriveWorkspace } from './useDriveWorkspace';
import { useMemberDisplayName } from './useMemberDisplayName';

export function useMemberName(
  namespaceId: string | null | undefined,
  memberId: string,
): { name: string | null; settled: boolean } {
  const { name: ownName, loaded } = useMemberDisplayName(namespaceId, memberId);
  const { namespaceMemberNames } = useDriveWorkspace();
  const name = ownName ?? namespaceMemberNames[memberId] ?? null;
  return { name, settled: name !== null || loaded };
}
