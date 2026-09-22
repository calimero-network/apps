// Peers editing the title. One resolve call covers every peer, because the
// title is one text sequence rather than a block per caret.

import { useEffect, useRef, useState } from 'react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import { titleCarets, type TitleCaret } from '@/lib/rich/cursors';
import type { DocPresence } from '@/lib/rich/presence';

/** What a re-resolve depends on; a fresh map identity is not a reason to call. */
function signature(peers: Map<string, DocPresence>): string {
  return [...peers]
    .map(([author, s]) => `${author}|${s.blockId ?? ''}|${s.anchor}|${s.head}`)
    .sort()
    .join('\n');
}

export function useTitleCursors(
  client: DocsClient | null,
  docId: string | null,
  peers: Map<string, DocPresence>,
  title: string,
): TitleCaret[] {
  const [carets, setCarets] = useState<TitleCaret[]>([]);
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const peerKey = signature(peers);

  useEffect(() => {
    // A null block is the title; an empty anchor is a withdrawn caret.
    const onTitle = [...peersRef.current].filter(
      ([, slice]) => !slice.blockId && slice.anchor && slice.head,
    );
    if (!client || !docId || onTitle.length === 0) {
      setCarets([]);
      return;
    }
    let live = true;
    void client
      .titleResolve({
        doc: docId,
        anchors: onTitle.flatMap(([, slice]) => [slice.anchor, slice.head]),
      })
      .then((resolved: (number | null)[]) => {
        if (!live) return;
        setCarets(
          titleCarets(
            onTitle.map(([author, slice], index) => ({
              author,
              name: slice.name,
              colour: slice.colour,
              anchor: resolved[index * 2] ?? null,
              head: resolved[index * 2 + 1] ?? null,
            })),
            title,
          ),
        );
      })
      .catch(() => setCarets([]));
    return () => {
      live = false;
    };
  }, [client, docId, peerKey, title]);

  return carets;
}
