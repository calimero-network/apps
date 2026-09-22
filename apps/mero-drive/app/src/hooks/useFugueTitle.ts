// Binds a plain text input to the document title CRDT: a keystroke becomes one
// scalar-indexed delta, a peer's TitleChanged becomes a re-read with the caret
// carried across on an anchor, and the caret is published as live presence.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useEphemeral,
  useSubscription,
  type SubscriptionEventData,
} from '@calimero-network/mero-react';
import { diffText, type Change } from '@/lib/rich/delta';
import { parseRichEvents } from '@/lib/rich/events';
import { utf16ToScalar } from '@/lib/rich/offsets';
import {
  peersOnDoc,
  presenceColour,
  type DocPresence,
} from '@/lib/rich/presence';
import { mapScalarSelection } from '@/lib/rich/remote';
import { UndoHistory } from '@/lib/rich/undo';
import { isContextEvent } from './useContextEvents';

const CARET_DEBOUNCE_MS = 200; // one anchor mint per pause, not per keystroke
const REFRESH_DEBOUNCE_MS = 150; // coalesces a typing peer's event burst

/**
 * The title half of the documents contract. Structurally what the generated
 * client exposes, so the hook takes either.
 */
export interface TitleClient {
  getTitle(params: { doc: string }): Promise<string>;
  titleApplyDelta(params: { doc: string; ops: Change[] }): Promise<string>;
  titleUndo(params: { doc: string; token: string }): Promise<string>;
  titleAnchorAt(params: {
    doc: string;
    position: number;
    before: boolean;
  }): Promise<string>;
  titleResolve(params: {
    doc: string;
    anchors: string[];
  }): Promise<(number | null)[]>;
}

export interface UseFugueTitleOptions {
  client: TitleClient | null;
  docId: string | null;
  contextId: string | null;
  /** Who peers see on this caret; presence is published only when given. */
  identity?: { id: string; name: string } | null;
}

export interface UseFugueTitleResult {
  title: string;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelect: () => void;
  undo: () => void;
  redo: () => void;
  peers: Map<string, DocPresence>;
  error: Error | null;
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

export function useFugueTitle({
  client,
  docId,
  contextId,
  identity,
}: UseFugueTitleOptions): UseFugueTitleResult {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // What the backend is believed to hold, so a re-read can tell our own write
  // from a peer's without a round trip per keystroke.
  const localRef = useRef('');
  const anchorRef = useRef<string | null>(null);
  const caretRef = useRef<number | null>(null);
  const historyRef = useRef(new UndoHistory(docId));
  const caretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contextIds = useMemo(() => (contextId ? [contextId] : []), [contextId]);
  const { peers, setPresence } = useEphemeral<DocPresence>(contextId, {
    throttleMs: CARET_DEBOUNCE_MS,
  });
  const publishRef = useRef(setPresence);
  publishRef.current = setPresence;

  useEffect(() => {
    historyRef.current.reset(docId);
    anchorRef.current = null;
    localRef.current = '';
    setTitle('');
    if (!client || !docId) return;
    let live = true;
    client
      .getTitle({ doc: docId })
      .then((text) => {
        if (!live) return;
        localRef.current = text;
        setTitle(text);
      })
      .catch((cause) => live && setError(asError(cause)));
    return () => {
      live = false;
    };
  }, [client, docId]);

  useEffect(
    () => () => {
      if (caretTimerRef.current) clearTimeout(caretTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  const publishCaret = useCallback(() => {
    if (caretTimerRef.current) clearTimeout(caretTimerRef.current);
    caretTimerRef.current = setTimeout(() => {
      caretTimerRef.current = null;
      const caret = inputRef.current?.selectionStart;
      if (!client || !docId || caret === null || caret === undefined) return;
      client
        .titleAnchorAt({
          doc: docId,
          position: utf16ToScalar(localRef.current, caret),
          before: true,
        })
        .then((anchor) => {
          anchorRef.current = anchor;
          if (!identity) return;
          publishRef.current({
            docId,
            blockId: null,
            anchor,
            head: anchor,
            name: identity.name,
            colour: presenceColour(identity.id),
          });
        })
        .catch((cause) => setError(asError(cause)));
    }, CARET_DEBOUNCE_MS);
  }, [client, docId, identity]);

  const refresh = useCallback(async () => {
    if (!client || !docId) return;
    try {
      const text = await client.getTitle({ doc: docId });
      if (text === localRef.current) return;
      const anchor = anchorRef.current;
      if (anchor) {
        const resolved = await client.titleResolve({
          doc: docId,
          anchors: [anchor],
        });
        caretRef.current = mapScalarSelection(text, resolved)[0];
      }
      localRef.current = text;
      setTitle(text);
    } catch (cause) {
      setError(asError(cause));
    }
  }, [client, docId]);

  const handleEvent = useCallback(
    (event: SubscriptionEventData) => {
      if (!isContextEvent(event) || !docId) return;
      const mine = parseRichEvents(event.data).some(
        (parsed) => parsed.kind === 'TitleChanged' && parsed.doc === docId,
      );
      if (!mine) return;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void refresh();
      }, REFRESH_DEBOUNCE_MS);
    },
    [docId, refresh],
  );
  useSubscription(contextIds, handleEvent);

  // A re-read replaces the whole value, so the caret the anchor resolved to
  // has to be put back once React has rendered it.
  useEffect(() => {
    const caret = caretRef.current;
    caretRef.current = null;
    const input = inputRef.current;
    if (caret === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caret, caret);
  }, [title]);

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      const ops = diffText(localRef.current, next);
      setTitle(next);
      publishCaret();
      if (ops.length === 0 || !client || !docId) return;
      localRef.current = next;
      client
        .titleApplyDelta({ doc: docId, ops })
        .then((token) => historyRef.current.record(token))
        .catch((cause) => setError(asError(cause)));
    },
    [client, docId, publishCaret],
  );

  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      if (!client || !docId) return;
      const history = historyRef.current;
      const apply = (token: string) => client.titleUndo({ doc: docId, token });
      const ran =
        direction === 'undo' ? history.undo(apply) : history.redo(apply);
      ran
        .then((moved) => (moved ? refresh() : undefined))
        .catch((cause) => setError(asError(cause)));
    },
    [client, docId, refresh],
  );
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  const visiblePeers = useMemo(
    () => peersOnDoc(peers, docId ?? ''),
    [peers, docId],
  );

  return {
    title,
    inputRef,
    onChange,
    onSelect: publishCaret,
    undo,
    redo,
    peers: visiblePeers,
    error,
  };
}
