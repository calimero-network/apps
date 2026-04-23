// Folder membership read + mutation. Wraps mero-react's
// useGroupMembers / useAddGroupMembers / useRemoveGroupMembers so
// the UI can list members and invite/kick without touching the
// admin-API directly.
//
// Note: mero-react's GroupMember shape carries `role: string` rather
// than `capabilities: number`. Capability bits are read separately
// via useGroupCapabilities (per-member) in permission-aware UI.
// This hook intentionally stays at the role/identity layer — the
// permission hooks in Phase 6 own the cap-bit surface.

import { useCallback } from 'react';
import {
  useGroupMembers,
  useAddGroupMembers,
  useRemoveGroupMembers,
  type GroupMember,
} from '@calimero-network/mero-react';

export interface FolderMembershipState {
  members: GroupMember[];
  loading: boolean;
  error: Error | null;
  /** Invite by identity; server assigns the default role for the
   *  group. Caps can be adjusted afterwards via useGroupCapabilities. */
  add: (identity: string, role?: string) => Promise<void>;
  remove: (identity: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useFolderMembership(folderId: string | null): FolderMembershipState {
  const { members, loading, error, refetch } = useGroupMembers(folderId);
  const { addGroupMembers } = useAddGroupMembers();
  const { removeGroupMembers } = useRemoveGroupMembers();

  const add = useCallback(
    async (identity: string, role: string = 'member') => {
      if (!folderId) return;
      await addGroupMembers(folderId, { members: [{ identity, role }] });
      await refetch();
    },
    [folderId, addGroupMembers, refetch],
  );

  const remove = useCallback(
    async (identity: string) => {
      if (!folderId) return;
      await removeGroupMembers(folderId, { members: [identity] });
      await refetch();
    },
    [folderId, removeGroupMembers, refetch],
  );

  return { members, loading, error, add, remove, refetch };
}
