// Whether another member can open the open doc's folder. The node's member list
// for a folder is its effective membership, so it already applies inheritance,
// admin and capability rules; this only reads it.

import { useCallback } from 'react';
import type { GroupMember } from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';
import {
  useFolderMembership,
  type FolderMembershipState,
} from './useFolderMembership';

type MemberList = Pick<FolderMembershipState, 'readFor'> & {
  members: Pick<GroupMember, 'identity'>[];
};

/** Whether `member` can open `folderId`, from the last list read for that folder; undefined while unknown. */
export function canOpenFolder(
  list: MemberList,
  folderId: string | undefined,
  member: string,
  self: string | null,
): boolean | undefined {
  if (!folderId || list.readFor !== folderId) return undefined;
  const ids = list.members.map((m) => m.identity);
  // You can open the doc, so a list without you is not this folder's yet.
  if (!self || !ids.includes(self)) return undefined;
  return ids.includes(member);
}

/** Answers "can this member open `folderId`?" for the doc being edited. */
export function useFolderReach(
  folderId: string | undefined,
): (member: string) => boolean | undefined {
  const { selfIdentity } = useDriveWorkspace();
  const { members, readFor } = useFolderMembership(folderId ?? null);
  return useCallback(
    (member: string) =>
      canOpenFolder({ members, readFor }, folderId, member, selfIdentity),
    [members, readFor, folderId, selfIdentity],
  );
}
