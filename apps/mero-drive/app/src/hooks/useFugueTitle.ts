// Binds the title input to the title CRDT the way the body is bound: the input
// always equals the node's last known title plus the user's pending edit. A
// peer's change is transformed past that edit and the caret carried through it;
// every write is guarded by the title it was diffed against.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  useSubscription,
  type SubscriptionEventData,
} from '@calimero-network/mero-react';
import { diffText, insertTextAt, type Change } from '@/lib/rich/delta';
import { parseRichEvents } from '@/lib/rich/events';
import { scalarToUtf16, utf16ToScalar } from '@/lib/rich/offsets';
import { applyChanges, moveInserts, transform, transformPosition } from '@/lib/rich/ot';
import { isTransportFailure } from '@/lib/rich/transport';
import { UndoHistory } from '@/lib/rich/undo';
import type { CaretSlice } from './useDocPresence';
import type { ChangePayload, DocsClient } from '@/generated/docs/DocsClient';
import type { SaveStatus } from '@/components/editor/types';
import { isContextEvent } from './useContextEvents';
import { useRetry } from './useRetry';

const CARET_DEBOUNCE_MS = 200; // one anchor mint per pause, not per keystroke
const REFRESH_DEBOUNCE_MS = 50; // coalesces a typing peer's event burst
const RECONCILE_MS = 4000; // an event lost while the node restarted still lands
const UNDO_GROUP_MS = 500; // writes closer than this undo as one step, as in the body

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
  /** Undo and redo shortcuts, taken from the browser's own input history. */
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  undo: () => void;
  redo: () => void;
  error: Error | null;
  status: SaveStatus;
  /** False until the title is read; an edit before then has nothing to diff against. */
  loaded: boolean;
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const applyText = (text: string, ops: Change[]): string =>
  applyChanges([{ text, attributes: {} }], ops)
    .map((span) => span.text)
    .join('');

export function useFugueTitle({
  client,
  docId,
  contextId,
  publish,
}: UseFugueTitleOptions): UseFugueTitleResult {
  const [title, showTitle] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The title as the node last reported it, and the input's current value.
  const serverRef = useRef('');
  const localRef = useRef('');
  const loadedRef = useRef(false);
  const dirtyRef = useRef(false);
  const staleRef = useRef(false);
  const inFlightRef = useRef(false);
  // Where the caret goes once React has rendered a value a peer changed.
  const caretRef = useRef<{ anchor: number; head: number } | null>(null);
  // The gap after this client's last write, as the node names it and where it sits in serverRef.
  const anchorRef = useRef<{ token: string; pos: number } | null>(null);
  // One entry per typing burst: the write tokens in the order they landed.
  const historyRef = useRef(new UndoHistory<string[]>(docId));
  const openGroupRef = useRef<string[] | null>(null);
  const lastWriteAtRef = useRef(0);
  const caretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainRef = useRef<(() => Promise<void>) | null>(null);
  const { schedule: scheduleRetry, reset: resetRetry } = useRetry(
    () => void drainRef.current?.(),
  );

  const contextIds = useMemo(() => (contextId ? [contextId] : []), [contextId]);
  const publishRef = useRef(publish);
  publishRef.current = publish;

  /** The user's edit over the node's title; typing on at the anchor stays an insert there. */
  const pending = useCallback((): Change[] => {
    const anchor = anchorRef.current;
    const base = serverRef.current;
    return (anchor && insertTextAt(base, localRef.current, anchor.pos)) ?? diffText(base, localRef.current);
  }, []);

  /** Puts `after` in the input, the caret where `carry` moves its scalar offsets. */
  const show = useCallback((after: string, carry: (scalar: number) => number) => {
    const before = localRef.current;
    const input = inputRef.current;
    if (input && document.activeElement === input) {
      const moved = (utf16: number | null) => scalarToUtf16(after, carry(utf16ToScalar(before, utf16 ?? 0)));
      caretRef.current = { anchor: moved(input.selectionStart), head: moved(input.selectionEnd) };
    }
    localRef.current = after;
    // Rendered now: a key pressed before React renders would edit the old value.
    flushSync(() => showTitle(after));
  }, []);

  /** A peer moved the title from the node's last known value to `remote`. */
  const rebase = useCallback(
    (remote: string) => {
      const remoteChange = diffText(serverRef.current, remote, { keepShared: true });
      const incoming = transform(pending(), remoteChange, true);
      serverRef.current = remote;
      if (anchorRef.current) anchorRef.current.pos = transformPosition(remoteChange, anchorRef.current.pos);
      if (incoming.length > 0) show(applyText(localRef.current, incoming), (at) => transformPosition(incoming, at));
    },
    [pending, show],
  );

  /** A refused write whose edit is one insert at the anchor, replayed where the anchor now sits. */
  const rebaseAtAnchor = useCallback(
    (remote: string, at: number): boolean => {
      const anchor = anchorRef.current;
      const typed = anchor && insertTextAt(serverRef.current, localRef.current, anchor.pos);
      if (!typed) return false;
      const moved = moveInserts(typed, at);
      serverRef.current = remote;
      show(applyText(remote, moved.ops), () => moved.end);
      return true;
    },
    [show],
  );

  // False stops the drain loop: a transport failure defers to scheduleRetry.
  const flush = useCallback(async (): Promise<boolean> => {
    if (!client || !docId || !loadedRef.current) return true;
    const base = serverRef.current;
    const ops = pending();
    if (ops.length === 0) {
      setStatus('saved');
      return true;
    }
    setStatus('saving');
    try {
      // The generated ChangePayload is a tagged union; the contract takes
      // serde's untagged form, which is what `ops` already is.
      const anchor = anchorRef.current?.token ?? null;
      const result = await client.titleApplyDeltaOn({ doc: docId, base, ops: ops as unknown as ChangePayload[], anchor });
      if (result.applied && result.token) {
        if (openGroupRef.current) openGroupRef.current.push(result.token);
        else historyRef.current.record((openGroupRef.current = [result.token]));
        serverRef.current = applyText(base, ops);
      } else {
        dirtyRef.current = true;
      }
      if (result.applied || result.anchor_pos === null || !rebaseAtAnchor(result.text, result.anchor_pos)) {
        rebase(result.text);
      }
      anchorRef.current =
        result.anchor !== null && result.anchor_pos !== null ? { token: result.anchor, pos: result.anchor_pos } : null;
      setError(null);
      setStatus(result.applied ? 'saved' : 'saving');
      resetRetry();
      return true;
    } catch (cause) {
      if (isTransportFailure(cause)) {
        dirtyRef.current = true;
        setStatus('offline');
        scheduleRetry();
        return false;
      }
      setError(asError(cause));
      setStatus('error');
      staleRef.current = true;
      return true;
    }
  }, [client, docId, pending, rebase, rebaseAtAnchor, resetRetry, scheduleRetry]);

  const refresh = useCallback(async () => {
    if (!client || !docId) return;
    try {
      const remote = await client.getTitle({ doc: docId });
      if (!loadedRef.current) {
        loadedRef.current = true;
        serverRef.current = remote;
        localRef.current = remote;
        showTitle(remote);
        setLoaded(true);
        return;
      }
      rebase(remote);
    } catch (cause) {
      setError(asError(cause));
    }
  }, [client, docId, rebase]);

  const drain = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      while (dirtyRef.current || staleRef.current) {
        if (dirtyRef.current) {
          dirtyRef.current = false;
          if (!(await flush())) break;
        } else {
          staleRef.current = false;
          await refresh();
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [flush, refresh]);
  drainRef.current = drain;

  useEffect(() => {
    historyRef.current.reset(docId);
    openGroupRef.current = null;
    anchorRef.current = null;
    serverRef.current = '';
    localRef.current = '';
    loadedRef.current = false;
    setLoaded(false);
    dirtyRef.current = false;
    staleRef.current = false;
    resetRetry();
    setStatus('saved');
    showTitle('');
    if (!client || !docId) return;
    staleRef.current = true;
    void drain();
  }, [client, docId, drain, resetRetry]);

  useEffect(
    () => () => {
      if (caretTimerRef.current) clearTimeout(caretTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  // A peer's change re-renders the value, which moves the caret to the end;
  // put it where the change carried it before the browser paints.
  useLayoutEffect(() => {
    const caret = caretRef.current;
    caretRef.current = null;
    const input = inputRef.current;
    if (!caret || !input || document.activeElement !== input) return;
    input.setSelectionRange(Math.min(caret.anchor, caret.head), Math.max(caret.anchor, caret.head));
  }, [title]);

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
        .then((anchor) => publishRef.current?.({ blockId: null, anchor, head: anchor }))
        .catch((cause) => setError(asError(cause)));
    }, CARET_DEBOUNCE_MS);
  }, [client, docId]);

  const write = useCallback(
    (next: string) => {
      const now = Date.now();
      if (now - lastWriteAtRef.current > UNDO_GROUP_MS) openGroupRef.current = null;
      lastWriteAtRef.current = now;
      localRef.current = next;
      showTitle(next);
      dirtyRef.current = true;
      setStatus('unsaved');
      void drain();
    },
    [drain],
  );

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      write(event.target.value);
      publishCaret();
    },
    [write, publishCaret],
  );

  const handleEvent = useCallback(
    (event: SubscriptionEventData) => {
      if (!isContextEvent(event) || !docId) return;
      const mine = parseRichEvents(event.data).some(
        (parsed) => parsed.kind === 'TitleChanged' && parsed.doc === docId,
      );
      if (!mine) return;
      staleRef.current = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void drain();
      }, REFRESH_DEBOUNCE_MS);
    },
    [docId, drain],
  );
  useSubscription(contextIds, handleEvent);

  // A node restart drops the event stream, so a peer's title edit arrives on
  // no event; an idle re-read is what closes that window.
  useEffect(() => {
    if (!client || !docId) return;
    const timer = setInterval(() => {
      if (dirtyRef.current || inFlightRef.current) return;
      staleRef.current = true;
      void drain();
    }, RECONCILE_MS);
    return () => clearInterval(timer);
  }, [client, docId, drain]);

  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      if (!client || !docId) return;
      const history = historyRef.current;
      openGroupRef.current = null;
      // Newest write first; the inverses come back in the order redo replays them.
      const apply = async (group: string[]) => {
        const inverses: string[] = [];
        for (const token of [...group].reverse()) inverses.push(await client.titleUndo({ doc: docId, token }));
        return inverses;
      };
      const ran = direction === 'undo' ? history.undo(apply) : history.redo(apply);
      ran
        .then((moved) => {
          if (!moved) return;
          staleRef.current = true;
          return drain();
        })
        .catch((cause) => setError(asError(cause)));
    },
    [client, docId, drain],
  );
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);
  // A peer's change resets the input's value, which empties the browser's undo.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) redo();
      else undo();
    },
    [undo, redo],
  );

  return {
    title,
    inputRef,
    onChange,
    onSelect: publishCaret,
    onKeyDown,
    undo,
    redo,
    status,
    error,
    loaded,
  };
}
