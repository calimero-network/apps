// One presence slot per author per context, so the title and the body share a
// single publisher: two of them would overwrite each other's caret, and the
// node keeps only the latest value an author wrote.

import { useCallback, useMemo, useRef } from 'react';
import { useEphemeral } from '@calimero-network/mero-react';
import {
  peersOnDoc,
  presenceColour,
  type DocPresence,
} from '@/lib/rich/presence';

export const PRESENCE_THROTTLE_MS = 200; // bounds the burst while dragging

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
  // Read through refs: the caller builds `identity` inline, and a publisher
  // whose identity churns every render re-runs every effect that holds it.
  const publishRef = useRef(setPresence);
  publishRef.current = setPresence;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const publish = useCallback(
    (caret: CaretSlice) => {
      const who = identityRef.current;
      if (!docId || !who) return;
      publishRef.current({
        docId,
        ...caret,
        name: who.name,
        colour: presenceColour(who.id),
      });
    },
    [docId],
  );

  const onDoc = useMemo(
    () => peersOnDoc(peers, docId ?? ''),
    [peers, docId],
  );

  return { peers: onDoc, publish };
}
