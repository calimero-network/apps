import { useEffect, useRef } from 'react';
import { JOIN_SYNC_POLL_MS, useJoinSync } from '@calimero-network/mero-react';

/** The lobby whose match list has come back from the node, empty or not. */
export interface LobbyReadFor {
  namespaceId: string;
  contextId: string;
}

export interface LobbyJoinSyncOptions {
  /** The selected lobby's namespace. */
  namespaceId: string | null;
  /** The selected lobby's context, through which its matches are read. */
  contextId: string | null;
  /** Which lobby the last successful match-list read was for. */
  readFor: LobbyReadFor | null;
  /** Re-reads the match list. */
  reread: () => Promise<void> | void;
}

/**
 * A lobby just joined from an invitation link holds the invitation dialog on
 * "Syncing…" until its own state has been read here: the match list, read
 * through the lobby context once this node has entered it.
 *
 * Right after the join the node may not have synced the lobby, and then the
 * read fails (it does not come back empty), so a read that succeeds is the
 * lobby having arrived, even with no matches in it. Nothing else read the
 * lobby again after a failed first read, so while the gate is up it is
 * re-read on a timer.
 */
export function useLobbyJoinSync({
  namespaceId,
  contextId,
  readFor,
  reread,
}: LobbyJoinSyncOptions): boolean {
  const { isSyncing } = useJoinSync({
    namespaceId,
    settled:
      readFor !== null &&
      readFor.namespaceId === namespaceId &&
      readFor.contextId === contextId,
  });

  const rereadRef = useRef(reread);
  rereadRef.current = reread;
  useEffect(() => {
    if (!isSyncing) return undefined;
    const timer = setInterval(
      () => void rereadRef.current(),
      JOIN_SYNC_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [isSyncing]);

  return isSyncing;
}
