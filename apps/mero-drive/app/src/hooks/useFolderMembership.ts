// Group membership read + mutation. Used by both the namespace-level
// members panel (folderId = rootGroupId) and per-folder sharing UIs.
//
// Why we DON'T use mero-react's useGroupMembers here:
//   `mero.admin.listGroupMembers` is wire-shaped `{members, selfIdentity}`
//   but mero-js's typed client reads `.data` — returning `{data: undefined}`
//   that mero-react propagates as an empty list. Every namespace shows
//   "No members yet" even when the server response has entries. Same
//   workaround as useMemberCaps: call the admin client directly and
//   cast through unknown to read the true wire shape.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useMero,
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
  const { mero } = useMero();
  const { addGroupMembers } = useAddGroupMembers();
  const { removeGroupMembers } = useRemoveGroupMembers();

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    if (!mero || !folderId) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Cast through unknown because DTS and wire shape disagree:
      // some backend versions return `{ members, selfIdentity }`,
      // others return `{ data: [...], selfIdentity }`.
      const raw = (await mero.admin.listGroupMembers(
        folderId,
      )) as unknown as {
        members?: GroupMember[];
        data?: GroupMember[];
      };
      if (!aliveRef.current) return;
      setMembers(raw.members ?? raw.data ?? []);
    } catch (e: unknown) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [mero, folderId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

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
