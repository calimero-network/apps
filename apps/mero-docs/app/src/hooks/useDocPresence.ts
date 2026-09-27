// One presence slot per author per context, so the title and the body share a
// single publisher: two of them would overwrite each other's caret, and the
// node keeps only the latest value an author wrote.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEphemeral, useMero } from '@calimero-network/mero-react';
import {
  peersOnDoc,
  presenceColour,
  type DocPresence,
} from '@/lib/rich/presence';

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
  const { peers, setPresence } = useEphemeral<DocPresence>(contextId, {
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

  const publish = useCallback(
    (caret: CaretSlice) => {
      const who = identityRef.current;
      if (!docId || !who) return;
      lastCaretRef.current = { docId, caret };
      publishRef.current({
        docId,
        ...caret,
        name: who.name,
        colour: presenceColour(who.id),
      });
    },
    [docId],
  );

  // Peers only learn a name from a slice, and a remount forgets the caret, so
  // opening a doc or renaming announces the current name without a caret move.
  const name = identity?.name;
  useEffect(() => {
    const last = lastCaretRef.current;
    publish(last?.docId === docId ? last.caret : NO_CARET);
  }, [name, docId, publish]);

  // The node keeps replaying an author's last slice while it stays in the
  // context, so closing a doc must say so or its readers see a ghost.
  useEffect(() => {
    if (!ephemeral || !contextId || !docId) return;
    return () => void ephemeral.set(contextId, LEAVE_SLICE).catch(() => {});
  }, [ephemeral, contextId, docId]);

  const onDoc = useMemo(
    () => peersOnDoc(peers, docId ?? ''),
    [peers, docId],
  );

  return { peers: onDoc, publish };
}
