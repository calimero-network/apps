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
import { useContextEvents } from './useContextEvents';

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

  // Per-call sequence counter: each refetch bumps `fetchSeqRef` and
  // captures its own seq. When a response arrives, we drop it if a
  // newer fetch has been issued in the meantime. This guards against
  // BOTH unmount (the cleanup bumps the counter via the effect below)
  // AND folderId changes mid-flight — an earlier `aliveRef`-only
  // pattern only handled unmount, so a stale folder's response could
  // still overwrite the new folder's members.
  const fetchSeqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mero || !folderId) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++fetchSeqRef.current;
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
      if (seq !== fetchSeqRef.current) return;
      setMembers(raw.members ?? raw.data ?? []);
    } catch (e: unknown) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [mero, folderId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Live-refresh when remote membership ops land. The same group
  // context the row data comes from also emits the events; the
  // sequence guard in `refetch` handles overlapping fetches.
  const onMembershipEvent = useCallback(() => {
    void refetch();
  }, [refetch]);
  useContextEvents(folderId, onMembershipEvent);

  // Bump the sequence on unmount so any still-in-flight response
  // becomes a no-op (its captured seq won't match anymore). React 18+
  // would silently drop the setState anyway, but this also short-
  // circuits the `setLoading(false)` in the finally block.
  useEffect(
    () => () => {
      fetchSeqRef.current++;
    },
    [],
  );

  const add = useCallback(
    // Core's MemberRole is a PascalCase serde enum
    // (`Admin | Member | ReadOnly | ReadOnlyTee`); lowercase `member`
    // is rejected with a 400 deserialize error.
    async (identity: string, role: string = 'Member') => {
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
