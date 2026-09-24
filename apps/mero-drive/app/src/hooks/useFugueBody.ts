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
import { UndoHistory } from '@/lib/rich/undo';
import type { SaveStatus } from '@/components/editor/types';
import { isContextEvent } from './useContextEvents';

const FLUSH_DEBOUNCE_MS = 300; // one diff per typing pause, not per keystroke
const REFRESH_DEBOUNCE_MS = 150; // coalesces a typing peer's event burst

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

  const flush = useCallback(async () => {
    const document = pendingRef.current;
    pendingRef.current = null;
    if (!document || !client || !docId) return;
    const next = fromBlockNote(document);
    const calls = diffBlocks(
      withBackendIds(appliedRef.current),
      withBackendIds(next),
    );
    appliedRef.current = next;
    if (calls.length === 0) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    try {
      await runCalls(client, docId, calls);
      setError(null);
      setStatus('saved');
    } catch (cause) {
      setError(asError(cause));
      setStatus('error');
      // The local model no longer matches the backend, so take its word for it.
      staleRef.current = true;
    }
  }, [client, docId, runCalls, withBackendIds]);

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
        if (pendingRef.current) await flush();
        else {
          staleRef.current = false;
          await refresh();
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [flush, refresh]);

  useEffect(() => {
    historyRef.current.reset(docId);
    idMapRef.current = new Map();
    appliedRef.current = [];
    pendingRef.current = null;
    loadedRef.current = false;
    setContent(undefined);
    setLoading(true);
    if (!client || !docId) return;
    void refresh();
  }, [client, docId, refresh]);

  useEffect(
    () => () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
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
