// Binds the BlockNote document to the body CRDT. A burst of keystrokes is
// coalesced into one diff, the diff becomes the ordered backend calls, and a
// peer's event becomes a re-read applied only when the render actually differs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useSubscription,
  type SubscriptionEventData,
} from '@calimero-network/mero-react';
import type { ChangePayload, DocsClient } from '@/generated/docs/DocsClient';
import {
  diffBlocks,
  isPlaceholder,
  type BlockCall,
  type EditorBlock,
} from '@/lib/rich/blocks';
import {
  backendBlocks,
  fromBlockNote,
  toBlockNote,
  type BlockNoteBlock,
} from '@/lib/rich/blocknote';
import { parseRichEvents } from '@/lib/rich/events';
import { isTransportFailure } from '@/lib/rich/transport';
import { UndoHistory } from '@/lib/rich/undo';
import type { SaveStatus } from '@/components/editor/types';
import { isContextEvent } from './useContextEvents';

const FLUSH_DEBOUNCE_MS = 300; // one diff per typing pause, not per keystroke
const REFRESH_DEBOUNCE_MS = 150; // coalesces a typing peer's event burst
const INITIAL_RETRY_DELAY_MS = 1000; // backoff for a write the node never answered
const MAX_RETRY_DELAY_MS = 10_000;
const RECONCILE_MS = 4000; // an event lost while the node restarted still lands

export interface UseFugueBodyOptions {
  client: DocsClient | null;
  docId: string | null;
  contextId: string | null;
}

export interface UseFugueBodyResult {
  /** The document as EditorShell's opaque serialized string, or undefined. */
  content: string | undefined;
  onContentChange: (content: string) => void;
  status: SaveStatus;
  loading: boolean;
  error: Error | null;
  undo: () => void;
  redo: () => void;
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const editorIdOf = (placeholder: string): string => placeholder.slice(4);

/** One undoable body write: the backend takes the block as well as the token. */
interface BodyUndo {
  block: string;
  token: string;
}

function parseDocument(content: string): BlockNoteBlock[] {
  const parsed: unknown = JSON.parse(content);
  return Array.isArray(parsed) ? (parsed as BlockNoteBlock[]) : [];
}

export function useFugueBody({
  client,
  docId,
  contextId,
}: UseFugueBodyOptions): UseFugueBodyResult {
  const [content, setContent] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // The document as last reconciled with the backend, in editor ids.
  const appliedRef = useRef<EditorBlock[]>([]);
  // A block the editor minted keeps its own id until a call answers a real one.
  const idMapRef = useRef(new Map<string, string>());
  const historyRef = useRef(new UndoHistory<BodyUndo>(docId));
  const pendingRef = useRef<BlockNoteBlock[] | null>(null);
  const inFlightRef = useRef(false);
  const staleRef = useRef(false);
  const loadedRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY_MS);
  // Breaks the flush→scheduleRetry→drain cycle without reordering the
  // useCallback declarations below.
  const drainRef = useRef<(() => Promise<void>) | null>(null);

  const contextIds = useMemo(() => (contextId ? [contextId] : []), [contextId]);

  const backendId = useCallback(
    (editorId: string) => idMapRef.current.get(editorId) ?? editorId,
    [],
  );
  const withBackendIds = useCallback(
    (blocks: EditorBlock[]): EditorBlock[] =>
      blocks.map((block) => ({ ...block, id: backendId(block.id) })),
    [backendId],
  );

  const runCalls = useCallback(
    async (target: DocsClient, doc: string, calls: BlockCall[]) => {
      const minted = new Map<string, string>();
      const real = (ref: string | null) =>
        ref === null ? null : minted.get(ref) ?? ref;
      for (const call of calls) {
        switch (call.call) {
          case 'merge_blocks':
            await target.mergeBlocks({
              doc,
              first: real(call.first) as string,
              second: real(call.second) as string,
            });
            break;
          case 'split_block':
            minted.set(
              call.ref,
              await target.splitBlock({
                doc,
                block: real(call.block) as string,
                at: call.at,
              }),
            );
            break;
          case 'insert_block':
            minted.set(
              call.ref,
              await target.insertBlock({
                doc,
                after: real(call.after),
                kind: call.kind,
                depth: call.depth,
              }),
            );
            break;
          case 'delete_block':
            await target.deleteBlock({
              doc,
              block: real(call.block) as string,
            });
            break;
          case 'move_block':
            await target.moveBlock({
              doc,
              block: real(call.block) as string,
              after: real(call.after),
            });
            break;
          case 'set_kind':
            await target.setKind({
              doc,
              block: real(call.block) as string,
              kind: call.kind,
            });
            break;
          case 'set_depth':
            await target.setDepth({
              doc,
              block: real(call.block) as string,
              depth: call.depth,
            });
            break;
          case 'set_attr':
            await target.setAttr({
              doc,
              block: real(call.block) as string,
              key: call.key,
              value: call.value,
            });
            break;
          case 'apply_delta': {
            const block = real(call.block) as string;
            historyRef.current.record({
              block,
              // The generated ChangePayload is a tagged union; the contract
              // takes serde's untagged form, which is what `ops` already is.
              token: await target.applyDelta({
                doc,
                block,
                ops: call.ops as unknown as ChangePayload[],
              }),
            });
            break;
          }
        }
      }
      for (const [ref, id] of minted) {
        if (isPlaceholder(ref)) idMapRef.current.set(editorIdOf(ref), id);
      }
    },
    [],
  );

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current) return; // already scheduled
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void drainRef.current?.();
    }, delay);
  }, []);

  // Returns false when the drain loop should stop rather than keep spinning:
  // a transport failure defers the next attempt to `scheduleRetry` instead.
  const flush = useCallback(async (): Promise<boolean> => {
    const document = pendingRef.current;
    pendingRef.current = null;
    if (!document || !client || !docId) return true;
    const next = fromBlockNote(document);
    const calls = diffBlocks(
      withBackendIds(appliedRef.current),
      withBackendIds(next),
    );
    if (calls.length === 0) {
      appliedRef.current = next;
      setStatus('saved');
      return true;
    }
    setStatus('saving');
    try {
      await runCalls(client, docId, calls);
      appliedRef.current = next;
      setError(null);
      setStatus('saved');
      retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
      return true;
    } catch (cause) {
      if (isTransportFailure(cause)) {
        // The node never saw `calls`, so keep diffing from the old
        // `appliedRef` on retry instead of advancing past a failed write.
        pendingRef.current ??= document;
        setStatus('offline');
        scheduleRetry();
        return false;
      }
      appliedRef.current = next;
      setError(asError(cause));
      setStatus('error');
      // The local model no longer matches the backend, so take its word for it.
      staleRef.current = true;
      return true;
    }
  }, [client, docId, runCalls, scheduleRetry, withBackendIds]);

  const refresh = useCallback(async () => {
    if (!client || !docId) return;
    try {
      const rows = await client.getDocument({ doc: docId });
      const blocks = backendBlocks(rows);
      // A re-read must not clear a failed write's error: the write is still
      // the thing that needs reporting, and only a later success settles it.
      setStatus((prev) => (prev === 'error' ? prev : 'saved'));
      if (!loadedRef.current) setError(null);
      // String equality would churn: the editor serializes default props this
      // model drops. An empty call list is the real "nothing to apply" test.
      if (
        loadedRef.current &&
        diffBlocks(withBackendIds(appliedRef.current), blocks).length === 0
      ) {
        return;
      }
      loadedRef.current = true;
      // A re-read speaks backend ids, so the editor-id map starts over.
      idMapRef.current = new Map();
      appliedRef.current = blocks;
      setContent(JSON.stringify(toBlockNote(blocks)));
    } catch (cause) {
      setError(asError(cause));
    } finally {
      setLoading(false);
    }
  }, [client, docId, withBackendIds]);

  // A local write and a re-read cannot interleave: the re-read would replace
  // the editor with a document the in-flight calls have not reached yet.
  const drain = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      while (pendingRef.current || staleRef.current) {
        if (pendingRef.current) {
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
    idMapRef.current = new Map();
    appliedRef.current = [];
    pendingRef.current = null;
    loadedRef.current = false;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
    setContent(undefined);
    setLoading(true);
    if (!client || !docId) return;
    void refresh();
  }, [client, docId, refresh]);

  // A node restart drops the event stream, so an edit made while it was away
  // arrives on no event; an idle re-read is what closes that window.
  useEffect(() => {
    if (!client || !docId) return;
    const timer = setInterval(() => {
      if (pendingRef.current || inFlightRef.current) return;
      staleRef.current = true;
      void drainRef.current?.();
    }, RECONCILE_MS);
    return () => clearInterval(timer);
  }, [client, docId]);

  useEffect(
    () => () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    [],
  );

  // Closing the editor inside the debounce window still sends the last edit.
  useEffect(
    () => () => {
      if (flushTimerRef.current) void drain();
    },
    [drain],
  );

  const onContentChange = useCallback(
    (serialized: string) => {
      let document: BlockNoteBlock[];
      try {
        document = parseDocument(serialized);
      } catch (cause) {
        setError(asError(cause));
        return;
      }
      pendingRef.current = document;
      setStatus('unsaved');
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        void drain();
      }, FLUSH_DEBOUNCE_MS);
    },
    [drain],
  );

  const handleEvent = useCallback(
    (event: SubscriptionEventData) => {
      if (!isContextEvent(event) || !docId) return;
      const touched = parseRichEvents(event.data).some(
        (parsed) => parsed.kind !== 'TitleChanged' && parsed.doc === docId,
      );
      if (!touched) return;
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

  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      if (!client || !docId) return;
      const history = historyRef.current;
      const apply = async ({ block, token }: BodyUndo) => {
        const inverse = await client.undo({ doc: docId, block, token });
        staleRef.current = true;
        void drain();
        return { block, token: inverse };
      };
      const ran =
        direction === 'undo' ? history.undo(apply) : history.redo(apply);
      ran.catch((cause) => setError(asError(cause)));
    },
    [client, docId, drain],
  );
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  return {
    content,
    onContentChange,
    status,
    loading,
    error,
    undo,
    redo,
  };
}
