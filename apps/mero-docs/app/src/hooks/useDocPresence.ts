// One presence slot per author per context, so the title and the body share a
// single publisher: two of them would overwrite each other's caret, and the
// node keeps only the latest value an author wrote.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEphemeral, useMero } from '@calimero-network/mero-react';
import { PRESENCE_BEAT_MS, PRESENCE_STALE_MS } from '@/lib/presenceTiming';
import { cancelLeave, leaveContext } from '@/lib/presenceLeave';
import {
  peersOnDoc,
  presenceColour,
  type DocPresence,
} from '@/lib/rich/presence';
import { useNow } from './useNow';

export const PRESENCE_THROTTLE_MS = 200; // bounds the burst while dragging
const NO_CARET: CaretSlice = { blockId: null, anchor: '', head: '' }; // listed as here, drawn nowhere
const LEAVE_SLICE = {}; // names no doc, so every reader drops the author

/** Where the caret is: a null block is the title, anchors are bs58 tokens. */
export interface CaretSlice {
  blockId: string | null;
  anchor: string;
  head: string;
}

export interface UseDocPresenceResult {
  peers: Map<string, DocPresence>;
  publish: (caret: CaretSlice) => void;
}

export function useDocPresence(
  contextId: string | null,
  docId: string | null,
  identity: { id: string; name: string } | null | undefined,
): UseDocPresenceResult {
  const { peers, setPresence, ageOf } = useEphemeral<DocPresence>(contextId, {
    throttleMs: PRESENCE_THROTTLE_MS,
  });
  const ephemeral = useMero().mero?.ephemeral;
  // Read through refs: the caller builds `identity` inline, and a publisher
  // whose identity churns every render re-runs every effect that holds it.
  const publishRef = useRef(setPresence);
  publishRef.current = setPresence;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const lastCaretRef = useRef<{ docId: string; caret: CaretSlice } | null>(
    null,
  );
  const beatRef = useRef(0);

  const publish = useCallback(
    (caret: CaretSlice) => {
      const who = identityRef.current;
      if (!docId || !who) return;
      if (contextId) cancelLeave(contextId);
      lastCaretRef.current = { docId, caret };
      publishRef.current({
        docId,
        ...caret,
        name: who.name,
        colour: presenceColour(who.id),
        n: beatRef.current,
      });
    },
    [contextId, docId],
  );

  const announce = useCallback(() => {
    const last = lastCaretRef.current;
    publish(last?.docId === docId ? last.caret : NO_CARET);
  }, [docId, publish]);

  // Peers only learn a name from a slice, and a remount forgets the caret, so
  // opening a doc or renaming announces the current name without a caret move.
  const name = identity?.name;
  useEffect(announce, [name, announce]);

  // The node keeps replaying an author's last slice while it stays in the
  // context, so an open doc re-announces every beat and a hidden or closed one leaves.
  useEffect(() => {
    if (!ephemeral || !contextId || !docId) return;
    const leave = () => leaveContext(ephemeral, contextId, LEAVE_SLICE);
    let timer: ReturnType<typeof setInterval> | undefined;
    const beat = () => {
      beatRef.current += 1;
      announce();
    };
    const onVisibility = () => {
      clearInterval(timer);
      if (document.visibilityState === 'hidden') return leave();
      announce();
      timer = setInterval(beat, PRESENCE_BEAT_MS);
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
      leave();
    };
  }, [ephemeral, contextId, docId, announce]);

  const fresh = useFreshPeers(peers, ageOf);
  const onDoc = useMemo(() => peersOnDoc(fresh, docId ?? ''), [fresh, docId]);

  return { peers: onDoc, publish };
}

/** The peers heard from within the stale window, re-read on every beat since ages grow silently. */
export function useFreshPeers<T>(
  peers: ReadonlyMap<string, T>,
  ageOf: (author: string) => number | undefined,
): Map<string, T> {
  const now = useNow(PRESENCE_BEAT_MS);
  return useMemo(() => {
    const fresh = new Map<string, T>();
    for (const [author, slice] of peers) {
      const age = ageOf(author);
      if (age !== undefined && age < PRESENCE_STALE_MS)
        fresh.set(author, slice);
    }
    return fresh;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` re-reads ageOf
  }, [peers, ageOf, now]);
}
