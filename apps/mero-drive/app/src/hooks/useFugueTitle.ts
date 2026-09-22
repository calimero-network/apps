// Binds a plain text input to the document title CRDT: a keystroke becomes one
// scalar-indexed delta, a peer's TitleChanged becomes a re-read with the caret
// carried across on an anchor, and the caret is published as live presence.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useSubscription,
  type SubscriptionEventData,
} from '@calimero-network/mero-react';
import { diffText } from '@/lib/rich/delta';
import { parseRichEvents } from '@/lib/rich/events';
import { scalarToUtf16, utf16ToScalar } from '@/lib/rich/offsets';
import { isTransportFailure } from '@/lib/rich/transport';
import { UndoHistory } from '@/lib/rich/undo';
import type { CaretSlice } from './useDocPresence';
import type { ChangePayload, DocsClient } from '@/generated/docs/DocsClient';
import type { SaveStatus } from '@/components/editor/types';
import { isContextEvent } from './useContextEvents';

const CARET_DEBOUNCE_MS = 200; // one anchor mint per pause, not per keystroke
const REFRESH_DEBOUNCE_MS = 150; // coalesces a typing peer's event burst
const INITIAL_RETRY_DELAY_MS = 1000; // backoff for a write the node never answered
const MAX_RETRY_DELAY_MS = 10_000;
const RECONCILE_MS = 4000; // an event lost while the node restarted still lands

export interface UseFugueTitleOptions {
  client: DocsClient | null;
  docId: string | null;
  contextId: string | null;
  /** Where to publish this caret; the document view owns the one slot. */
  publish?: (caret: CaretSlice) => void;
}

export interface UseFugueTitleResult {
  title: string;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelect: () => void;
  undo: () => void;
  redo: () => void;
  error: Error | null;
  status: SaveStatus;
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

export function useFugueTitle({
  client,
  docId,
  contextId,
  publish,
}: UseFugueTitleOptions): UseFugueTitleResult {
  const [title, showTitle] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // What the backend is believed to hold, so a re-read can tell our own write
  // from a peer's without a round trip per keystroke. Advanced the instant a
  // keystroke lands, so the next keystroke's diff is against the latest text.
  const localRef = useRef('');
  // What the backend has actually confirmed applying. Only this — not
  // `localRef` — decides the base of a retried delta, so a failed write's
  // characters are still in the diff on the next attempt.
  const confirmedRef = useRef('');
  const sendingRef = useRef(false);
  const anchorRef = useRef<string | null>(null);
  const caretRef = useRef<number | null>(null);
  const historyRef = useRef(new UndoHistory(docId));
  const caretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY_MS);
  // Breaks the sync→scheduleRetry→sync cycle without reordering declarations.
  const syncRef = useRef<(() => Promise<void>) | null>(null);

  const contextIds = useMemo(() => (contextId ? [contextId] : []), [contextId]);
  const publishRef = useRef(publish);
  publishRef.current = publish;

  useEffect(() => {
    historyRef.current.reset(docId);
    anchorRef.current = null;
    localRef.current = '';
    confirmedRef.current = '';
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
    setStatus('saved');
    showTitle('');
    if (!client || !docId) return;
    let live = true;
    client
      .getTitle({ doc: docId })
      .then((text) => {
        if (!live) return;
        localRef.current = text;
        confirmedRef.current = text;
        showTitle(text);
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
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
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
          publishRef.current?.({ blockId: null, anchor, head: anchor });
        })
        .catch((cause) => setError(asError(cause)));
    }, CARET_DEBOUNCE_MS);
  }, [client, docId]);

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
        caretRef.current =
          resolved[0] == null ? null : scalarToUtf16(text, resolved[0]);
      }
      localRef.current = text;
      confirmedRef.current = text;
      showTitle(text);
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

  // A node restart drops the event stream, so a peer's title edit arrives on
  // no event; an idle re-read is what closes that window.
  useEffect(() => {
    if (!client || !docId) return;
    const timer = setInterval(() => {
      if (localRef.current !== confirmedRef.current) return;
      void refresh();
    }, RECONCILE_MS);
    return () => clearInterval(timer);
  }, [client, docId, refresh]);

  // A re-read replaces the whole value, so the caret the anchor resolved to
  // has to be put back once React has rendered it.
  useEffect(() => {
    const caret = caretRef.current;
    caretRef.current = null;
    const input = inputRef.current;
    if (caret === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(caret, caret);
  }, [title]);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current) return; // already scheduled
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void syncRef.current?.();
    }, delay);
  }, []);

  // Diffs `confirmedRef` (backend truth) against `localRef` (the latest
  // typed text) and sends the result; a typing burst during an in-flight
  // or retried send is folded into the next diff, not sent as its own call.
  const sync = useCallback(async (): Promise<void> => {
    if (sendingRef.current || !client || !docId) return;
    const ops = diffText(confirmedRef.current, localRef.current);
    if (ops.length === 0) {
      setStatus('saved');
      return;
    }
    sendingRef.current = true;
    setStatus('saving');
    const target = localRef.current;
    let transportFailure = false;
    try {
      const token = await client
        // The generated ChangePayload is a tagged union; the contract takes
        // serde's untagged form, which is what `ops` already is.
        .titleApplyDelta({ doc: docId, ops: ops as unknown as ChangePayload[] });
      confirmedRef.current = target;
      historyRef.current.record(token);
      setError(null);
      retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
    } catch (cause) {
      if (isTransportFailure(cause)) {
        transportFailure = true;
        setStatus('offline');
        scheduleRetry();
      } else {
        // The node answered and refused the delta; give up on it, matching
        // the prior no-retry behavior, and leave only the error visible.
        confirmedRef.current = target;
        setError(asError(cause));
        setStatus('error');
      }
    } finally {
      sendingRef.current = false;
    }
    if (!transportFailure) {
      if (localRef.current !== confirmedRef.current) void sync();
      else setStatus('saved');
    }
  }, [client, docId, scheduleRetry]);
  syncRef.current = sync;

  const write = useCallback(
    (next: string) => {
      showTitle(next);
      localRef.current = next;
      void sync();
    },
    [sync],
  );

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      write(event.target.value);
      publishCaret();
    },
    [write, publishCaret],
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

  return {
    title,
    inputRef,
    onChange,
    onSelect: publishCaret,
    undo,
    redo,
    status,
    error,
  };
}
