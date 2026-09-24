// Peers' carets in the body editor, both directions. A peer publishes anchors
// on a block; this replica resolves them against its own copy of that block,
// which is the only reason a caret stays put while either side keeps typing.

import { useEffect, useRef } from 'react';
import type { DocsClient } from '@/generated/docs/DocsClient';
import {
  blockGeometry,
  type DocNode,
} from '@/components/editor/presence/geometry';
import { setPresenceDecorations } from '@/components/editor/presence/presencePlugin';
import {
  caretDecorations,
  scalarAt,
  type PeerCaret,
} from '@/lib/rich/cursors';
import { signature, type DocPresence } from '@/lib/rich/presence';
import type { CaretSlice } from './useDocPresence';

/** The slice of BlockNote this hook drives; narrowed so a test can fake it. */
export interface CursorEditor {
  prosemirrorState: {
    doc: DocNode;
    selection: { anchor: number; head: number };
  };
  prosemirrorView: Parameters<typeof setPresenceDecorations>[0];
  getTextCursorPosition(): { block: { id: string } } | undefined;
  onSelectionChange(callback: () => void): () => void;
}

export interface UseBodyCursorsOptions {
  client: DocsClient | null;
  docId: string | null;
  editor: CursorEditor | null;
  peers: Map<string, DocPresence>;
  publish: (caret: CaretSlice) => void;
  /** Changes whenever the body was re-read, so anchors resolve again. */
  revision: unknown;
}

interface AuthoredSlice {
  author: string;
  slice: DocPresence;
}

/** Peers with a caret on a body block, grouped so each block costs one call. */
function byBlock(peers: Map<string, DocPresence>): Map<string, AuthoredSlice[]> {
  const grouped = new Map<string, AuthoredSlice[]>();
  for (const [author, slice] of peers) {
    if (!slice.blockId || !slice.anchor || !slice.head) continue;
    const on = grouped.get(slice.blockId) ?? [];
    on.push({ author, slice });
    grouped.set(slice.blockId, on);
  }
  return grouped;
}

export function useBodyCursors({
  client,
  docId,
  editor,
  peers,
  publish,
  revision,
}: UseBodyCursorsOptions): void {
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const peerKey = signature(peers);

  useEffect(() => {
    if (!client || !docId || !editor) return;
    const current = peersRef.current;
    let live = true;

    void (async () => {
      const carets: PeerCaret[] = [];
      for (const [blockId, on] of byBlock(current)) {
        const anchors = on.flatMap(({ slice }) => [slice.anchor, slice.head]);
        let resolved: (number | null)[];
        try {
          resolved = (await client.resolveIds({
            doc: docId,
            block: blockId,
            anchors,
          })) as (number | null)[];
        } catch {
          continue; // a block this replica cannot read yet draws nothing
        }
        on.forEach(({ author, slice }, index) => {
          carets.push({
            author,
            name: slice.name,
            colour: slice.colour,
            blockId,
            anchor: resolved[index * 2] ?? null,
            head: resolved[index * 2 + 1] ?? null,
          });
        });
      }
      if (!live) return;
      const doc = editor.prosemirrorState.doc;
      setPresenceDecorations(
        editor.prosemirrorView,
        caretDecorations(carets, (blockId) => blockGeometry(doc, blockId)),
      );
    })();

    return () => {
      live = false;
    };
  }, [client, docId, editor, peerKey, revision]);

  useEffect(() => {
    if (!client || !docId || !editor) return;
    const send = () => {
      const blockId = editor.getTextCursorPosition()?.block?.id;
      if (!blockId) return;
      const geometry = blockGeometry(editor.prosemirrorState.doc, blockId);
      if (!geometry) return;
      const { anchor, head } = editor.prosemirrorState.selection;
      void Promise.all([
        client.anchorAt({
          doc: docId,
          block: blockId,
          position: scalarAt(geometry, anchor),
          before: true,
        }),
        client.anchorAt({
          doc: docId,
          block: blockId,
          position: scalarAt(geometry, head),
          before: true,
        }),
      ])
        .then(([anchorToken, headToken]) =>
          publishRef.current({
            blockId,
            anchor: anchorToken,
            head: headToken,
          }),
        )
        .catch(() => {
          /* a caret nobody can place is not worth an error surface */
        });
    };
    send();
    const unsubscribe = editor.onSelectionChange(send);
    return () => {
      unsubscribe();
      // An empty anchor is the withdrawal: every renderer skips it.
      publishRef.current({ blockId: null, anchor: '', head: '' });
    };
  }, [client, docId, editor]);
}
