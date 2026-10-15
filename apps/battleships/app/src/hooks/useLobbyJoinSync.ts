import { useEffect, useRef } from 'react';
import {
  isNamespaceJustJoined,
  JOIN_SYNC_POLL_MS,
  useJoinSync,
} from '@calimero-network/mero-react';

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
  /** Which lobby the last match-list read was for. */
  readFor: LobbyReadFor | null;
  /** How many matches that read returned. */
  matchCount: number;
  /** Re-reads the match list. */
  reread: () => Promise<void> | void;
}

/**
 * A lobby just joined from an invitation link holds the invitation dialog on
 * "Syncing…" until its own state has been read here: the match list, read
 * through the lobby context once this node has entered it.
 *
 * Right after the join the node may not have synced the lobby, so an empty
 * list is what it returns then: while the namespace is flagged just-joined an
 * empty read does not settle, the gate waits up to its ceiling, and the list
 * is re-read. Once the flag clears, a lobby with no matches reads as empty.
 */
export function useLobbyJoinSync({
  namespaceId,
  contextId,
  readFor,
  matchCount,
  reread,
}: LobbyJoinSyncOptions): boolean {
  const read =
    readFor !== null &&
    readFor.namespaceId === namespaceId &&
    readFor.contextId === contextId;
  const { isSyncing } = useJoinSync({
    namespaceId,
    settled: read && (matchCount > 0 || !isNamespaceJustJoined(namespaceId)),
    // Still empty: let the gate wait up to its ceiling, not the base window.
    active: matchCount === 0,
  });

  // Nothing else re-reads the list, so keep asking while the gate is up.
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
