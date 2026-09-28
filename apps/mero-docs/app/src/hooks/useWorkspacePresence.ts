// Who is in this workspace right now, over ephemeral presence on the registry
// context: the one context every namespace member shares.

import { useEffect, useMemo, useState } from 'react';
import { useEphemeral, useMero } from '@calimero-network/mero-react';
import {
  PRESENCE_BEAT_MS as BEAT_MS,
  PRESENCE_STALE_MS as STALE_MS,
} from '@/lib/presenceTiming';
import { cancelLeave, leaveContext } from '@/lib/presenceLeave';
import { useWarnOnError } from './useWarnOnError';

const LEAVE_SLICE = {}; // carries no account, so every reader drops the author

/** The author is the node's key, so `a` names the (self-asserted, never gating)
 *  account; `n` changes every beat so a live tab stays fresh. */
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
    let timer: ReturnType<typeof setInterval> | undefined;
    const beat = () => {
      cancelLeave(contextId);
      return ephemeral
        .set(contextId, { a: selfAccount, n: n++ })
        .catch((err: unknown) =>
          console.warn('[useWorkspacePresence] presence off', err),
        );
    };
    // The node heartbeats the last slice until it leaves the context, so say so.
    const leave = () => leaveContext(ephemeral, contextId, LEAVE_SLICE);
    // A hidden tab's timers can be throttled past STALE_MS, so it leaves instead.
    const onVisibility = () => {
      clearInterval(timer);
      if (document.visibilityState === 'hidden') return leave();
      void beat();
      timer = setInterval(beat, BEAT_MS);
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
      leave();
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
  const { peers, ageOf, error } =
    useEphemeral<WorkspacePresenceSlice>(contextId);
  useWarnOnError('[useWorkspacePresence] presence off', error);
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
