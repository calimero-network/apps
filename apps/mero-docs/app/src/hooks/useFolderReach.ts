// Whether another member can open a folder: the nearest restricted folder at or
// above it decides, since an open folder lets in whoever can open its parent.

import { useCallback } from 'react';
import type { GroupMember } from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';
import { useFolderMembership } from './useFolderMembership';

type FolderShape = {
  id: string;
  parent_id: string | null;
  visibility: 'Open' | 'Restricted' | undefined;
};
type MemberList = {
  members: Pick<GroupMember, 'identity'>[];
  loading: boolean;
  error: Error | null;
};

/** The restricted folder whose members may open `folderId`; null for the whole workspace, undefined while unknown. */
export function gatingFolder(
  folderId: string,
  folders: FolderShape[],
  rootId: string | null,
): string | null | undefined {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (let id: string | null = folderId; ; ) {
    if (id === null || id === rootId) return null;
    const f = byId.get(id);
    if (!f || !f.visibility || seen.has(id)) return undefined;
    if (f.visibility === 'Restricted') return f.id;
    seen.add(id);
    id = f.parent_id;
  }
}

/** Whether `member` can open a folder gated by `gate`; undefined while unknown. */
export function canOpenFolder(
  gate: string | null | undefined,
  list: MemberList,
  member: string,
  self: string | null,
): boolean | undefined {
  if (gate === null) return true;
  const ids = list.members.map((m) => m.identity);
  // You can open the doc, so a list without you has not been read yet.
  if (
    gate === undefined ||
    list.loading ||
    list.error ||
    !ids.includes(self ?? '')
  )
    return undefined;
  return ids.includes(member);
}

/** Answers "can this member open `folderId`?" for the doc being edited. */
export function useFolderReach(
  folderId: string | undefined,
): (member: string) => boolean | undefined {
  const { folders, rootGroupId, selfIdentity } = useDriveWorkspace();
  const gate = folderId
    ? gatingFolder(folderId, folders, rootGroupId)
    : undefined;
  const list = useFolderMembership(gate ?? null);
  return useCallback(
    (member: string) => canOpenFolder(gate, list, member, selfIdentity),
    [gate, list, selfIdentity],
  );
}
