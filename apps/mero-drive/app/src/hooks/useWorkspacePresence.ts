// Who is in this workspace right now, over ephemeral presence on the registry
// context: the one context every namespace member shares.

import { useEffect, useMemo, useState } from 'react';
import { useEphemeral, useMero } from '@calimero-network/mero-react';

const BEAT_MS = 10_000; // how often an open workspace changes its slice
const STALE_MS = 25_000; // a closed tab's node keeps replaying its last slice, so age it out here
const LEAVE_SLICE = {}; // carries no account, so every reader drops the author

/**
 * One device's slice. The ephemeral author is the node's key, not its account,
 * so the slice names the account; `n` changes every beat so a live tab stays
 * fresh. The account is self-asserted: it may light a presence dot, never gate.
 */
interface WorkspacePresenceSlice {
  a: string;
  n: number;
}

/** Announce `selfAccount` in `contextId` for as long as the caller is mounted. */
export function usePublishWorkspacePresence(
  contextId: string | null,
  selfAccount: string | null,
): void {
  const { mero } = useMero();
  const ephemeral = mero?.ephemeral;

  useEffect(() => {
    if (!ephemeral || !contextId || !selfAccount) return;
    let n = 0;
    const beat = () =>
      ephemeral
        .set(contextId, { a: selfAccount, n: n++ })
        .catch((err: unknown) =>
          console.warn('[useWorkspacePresence] presence off', err),
        );
    void beat();
    const timer = setInterval(beat, BEAT_MS);
    return () => {
      clearInterval(timer);
      // The node heartbeats the last slice until it leaves the context, so say so.
      void ephemeral.set(contextId, LEAVE_SLICE).catch(() => {});
    };
  }, [ephemeral, contextId, selfAccount]);
}

/**
 * The accounts in `members` present in `contextId`, `selfAccount` included.
 * A claim for an account outside `members`, or a malformed slice, is ignored.
 */
export function useWorkspacePresence(
  contextId: string | null,
  selfAccount: string | null,
  members: readonly string[],
): Set<string> {
  const { peers, ageOf } = useEphemeral<WorkspacePresenceSlice>(contextId);
  // Ages grow without any event, so re-read them on the beat.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), BEAT_MS);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    const memberSet = new Set(members);
    const present = new Set<string>();
    if (selfAccount && memberSet.has(selfAccount)) present.add(selfAccount);
    for (const [author, slice] of peers) {
      const account = typeof slice?.a === 'string' ? slice.a : '';
      const age = ageOf(author);
      if (memberSet.has(account) && age !== undefined && age < STALE_MS) {
        present.add(account);
      }
    }
    return present;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` re-reads ageOf
  }, [peers, ageOf, members, selfAccount, now]);
}
