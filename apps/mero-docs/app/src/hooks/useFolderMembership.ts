// Group membership read + mutation. Used by both the namespace-level
// members panel (folderId = rootGroupId) and per-folder sharing UIs.
//
// Reads through the admin client rather than mero-react's useGroupMembers
// so a stale reply can be dropped and a membership event can re-read.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useMero,
  useAddGroupMembers,
  useRemoveGroupMembers,
  type GroupMember,
} from '@calimero-network/mero-react';
import { useContextEvents } from './useContextEvents';
import { useDriveWorkspace } from './useDriveWorkspace';

export interface FolderMembershipState {
  members: GroupMember[];
  /** The folder `members` was last read for; a failed or running read keeps it. */
  readFor: string | null;
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
  const { registryContextId } = useDriveWorkspace();

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [readFor, setReadFor] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Per-call sequence counter: each refetch bumps `fetchSeqRef` and
  // captures its own seq. When a response arrives, we drop it if a
  // newer fetch has been issued in the meantime. This guards against
  // BOTH unmount (the cleanup bumps the counter via the effect below)
  // AND folderId changes mid-flight - an earlier `aliveRef`-only
  // pattern only handled unmount, so a stale folder's response could
  // still overwrite the new folder's members.
  const fetchSeqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mero || !folderId) {
      setMembers([]);
      setReadFor(null);
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const { members: rows } = await mero.admin.listGroupMembers(folderId);
      if (seq !== fetchSeqRef.current) return;
      setMembers(rows);
      setReadFor(folderId);
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

  // Membership events are group-keyed, not context events; the registry's
  // sync run is the tick, and `refetch`'s sequence guard drops stale replies.
  const onMembershipEvent = useCallback(() => {
    void refetch();
  }, [refetch]);
  useContextEvents(registryContextId, onMembershipEvent, { strict: true });

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
    // (`Admin | Member | ReadOnly | ReadOnlyTee | RelayTee`); lowercase `member`
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

  return { members, readFor, loading, error, add, remove, refetch };
}
