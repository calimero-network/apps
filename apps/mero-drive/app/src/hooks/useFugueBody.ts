// Binds the BlockNote document to the body CRDT. The editor always equals the
// node's last known state plus the user's pending edit: a peer's change is
// transformed past that edit before it touches one block, and every write is
// guarded by the text it was diffed against, so a stale write is refused and
// rebased instead of landing in the wrong place.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
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
  backendSpans,
  fromBlockNote,
  toBlockNote,
  type BlockNoteBlock,
} from '@/lib/rich/blocknote';
import { attrsEqual } from '@/lib/rich/attributes';
import { inlineOffset, textOffset } from '@/lib/rich/cursors';
import { diffSpans, spansToInline, type AttrSpan, type Change } from '@/lib/rich/delta';
import { parseRichEvents } from '@/lib/rich/events';
import { scalarToUtf16, utf16ToScalar } from '@/lib/rich/offsets';
import { applyChanges, transform, transformPosition } from '@/lib/rich/ot';
import { isTransportFailure } from '@/lib/rich/transport';
import { UndoHistory } from '@/lib/rich/undo';
import {
  blockGeometry,
  type DocNode,
} from '@/components/editor/presence/geometry';
import type { SaveStatus } from '@/components/editor/types';
import { isContextEvent } from './useContextEvents';

const FLUSH_DEBOUNCE_MS = 50; // a few keystrokes per write; correctness does not depend on it
const REFRESH_DEBOUNCE_MS = 50; // coalesces a typing peer's event burst
const INITIAL_RETRY_DELAY_MS = 1000; // backoff for a write the node never answered
const MAX_RETRY_DELAY_MS = 10_000;
const RECONCILE_MS = 4000; // an event lost while the node restarted still lands

/** The slice of the BlockNote editor the binding drives. */
export interface BodyEditor {
  readonly document: BlockNoteBlock[];
  readonly prosemirrorView: EditorView | undefined;
  updateBlock(id: string, update: Record<string, unknown>): unknown;
  insertBlocks(
    blocks: Record<string, unknown>[],
    reference: string,
    placement: 'before' | 'after',
  ): unknown;
  removeBlocks(ids: string[]): unknown;
  replaceBlocks(remove: string[], insert: Record<string, unknown>[]): unknown;
}

export interface UseFugueBodyOptions {
  client: DocsClient | null;
  docId: string | null;
  contextId: string | null;
  editor: BodyEditor | null;
}

export interface UseFugueBodyResult {
  /** The document as first loaded, for EditorShell's one-time content. */
  content: string | undefined;
  onContentChange: (content: string) => void;
  status: SaveStatus;
  loading: boolean;
  error: Error | null;
  undo: () => void;
  redo: () => void;
  /** Bumps on every change a peer made, so anchors are re-resolved. */
  revision: number;
  /** The backend id of a block the editor knows by its own id. */
  backendIdOf: (editorId: string) => string;
}

interface BodyUndo {
  block: string;
  token: string;
}

interface Caret {
  anchor: number;
  head: number;
}

interface Outcome {
  refused: boolean;
  structural: boolean;
  touched: Set<string>;
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const structureOf = (blocks: EditorBlock[]): string =>
  JSON.stringify(blocks.map((b) => [b.id, b.kind, b.depth, b.attrs]));

/** The caret's scalar offsets when it sits inside `editorId`'s text. */
function caretIn(view: EditorView, editorId: string): Caret | null {
  const geometry = blockGeometry(view.state.doc as unknown as DocNode, editorId);
  if (!geometry) return null;
  const end = geometry.contentStart + inlineOffset(geometry.items, geometry.text.length);
  const { anchor, head } = view.state.selection;
  const inside = (pos: number) => pos >= geometry.contentStart && pos <= end;
  if (!inside(anchor) || !inside(head)) return null;
  const toScalar = (pos: number) =>
    utf16ToScalar(geometry.text, textOffset(geometry.items, pos - geometry.contentStart));
  return { anchor: toScalar(anchor), head: toScalar(head) };
}

function placeCaret(view: EditorView, editorId: string, caret: Caret): void {
  const geometry = blockGeometry(view.state.doc as unknown as DocNode, editorId);
  if (!geometry) return;
  const toPos = (scalar: number) =>
    geometry.contentStart +
    inlineOffset(geometry.items, scalarToUtf16(geometry.text, scalar));
  const { doc } = view.state;
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(doc, toPos(caret.anchor), toPos(caret.head)),
    ),
  );
}

export function useFugueBody({
  client,
  docId,
  contextId,
  editor,
}: UseFugueBodyOptions): UseFugueBodyResult {
  const [content, setContent] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  // The document as the node last reported it, in backend ids.
  const serverRef = useRef<EditorBlock[]>([]);
  // A block the editor minted keeps its own id; this maps it to the node's.
  const idMapRef = useRef(new Map<string, string>());
  const historyRef = useRef(new UndoHistory<BodyUndo>(docId));
  const dirtyRef = useRef(false);
  const staleRef = useRef(false);
  const resyncRef = useRef(false);
  const inFlightRef = useRef(false);
  const loadedRef = useRef(false);
  const syncedRef = useRef(false);
  const editorRef = useRef<BodyEditor | null>(editor);
  editorRef.current = editor;
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY_MS);
  const drainRef = useRef<(() => Promise<void>) | null>(null);

  const contextIds = useMemo(() => (contextId ? [contextId] : []), [contextId]);

  const backendIdOf = useCallback(
    (editorId: string) => idMapRef.current.get(editorId) ?? editorId,
    [],
  );
  const editorIdOf = useCallback((backendId: string) => {
    for (const [editorId, id] of idMapRef.current) {
      if (id === backendId) return editorId;
    }
    return backendId;
  }, []);

  /** The editor's document as the flat list the diff takes, in backend ids. */
  const localBlocks = useCallback((): EditorBlock[] => {
    const live = editorRef.current;
    if (!live) return [];
    return fromBlockNote(live.document).map((block) => ({
      ...block,
      id: backendIdOf(block.id),
    }));
  }, [backendIdOf]);

  // Until the editor holds the loaded document, a diff against it would
  // delete everything the node has.
  const isSynced = useCallback((): boolean => {
    if (syncedRef.current) return true;
    const live = editorRef.current;
    if (!live || !loadedRef.current) return false;
    const held = new Set(localBlocks().map((block) => block.id));
    syncedRef.current = serverRef.current.every((block) => held.has(block.id));
    return syncedRef.current;
  }, [localBlocks]);

  const serverBlock = (id: string): EditorBlock | undefined =>
    serverRef.current.find((block) => block.id === id);

  /** `spans` into one editor block, the caret carried through `ops`. */
  const replaceInline = useCallback(
    (editorId: string, spans: AttrSpan[], ops: Change[]) => {
      const live = editorRef.current;
      if (!live) return;
      const view = live.prosemirrorView;
      const caret = view ? caretIn(view, editorId) : null;
      live.updateBlock(editorId, { content: spansToInline(spans) });
      if (view && caret) {
        placeCaret(view, editorId, {
          anchor: transformPosition(ops, caret.anchor),
          head: transformPosition(ops, caret.head),
        });
      }
    },
    [],
  );

  /** A peer moved one block from `base` to `remote`; carry that into the editor. */
  const rebaseBlock = useCallback(
    (backendId: string, base: AttrSpan[], remote: AttrSpan[]) => {
      const remoteChange = diffSpans(base, remote);
      if (remoteChange.length === 0) return;
      const editorId = editorIdOf(backendId);
      const local = localBlocks().find((block) => block.id === backendId);
      if (!local) return;
      const pending = diffSpans(base, local.inline);
      const incoming = transform(pending, remoteChange, true);
      if (incoming.length === 0) return;
      replaceInline(editorId, applyChanges(local.inline, incoming), incoming);
      setRevision((value) => value + 1);
    },
    [editorIdOf, localBlocks, replaceInline],
  );

  /** A remote block the editor does not hold yet, placed after its predecessor. */
  const insertRemote = (live: BodyEditor, remote: EditorBlock[], index: number) => {
    const [node] = toBlockNote([remote[index]]);
    const held = new Set(localBlocks().map((block) => block.id));
    for (let i = index - 1; i >= 0; i--) {
      if (held.has(remote[i].id)) {
        live.insertBlocks([node as unknown as Record<string, unknown>], editorIdOf(remote[i].id), 'after');
        return;
      }
    }
    const first = live.document[0];
    if (first) live.insertBlocks([node as unknown as Record<string, unknown>], first.id, 'before');
  };

  /**
   * Block-level changes a peer made, applied one block at a time. False means
   * a peer change it cannot place that way: a move, a depth or a nested insert.
   */
  const applyRemoteStructure = useCallback(
    (remote: EditorBlock[]): boolean => {
      const live = editorRef.current;
      if (!live) return false;
      const server = new Map(serverRef.current.map((b) => [b.id, b]));
      const remoteIds = new Set(remote.map((b) => b.id));
      const local = new Map(localBlocks().map((b) => [b.id, b]));

      const common = remote.map((b) => b.id).filter((id) => server.has(id) && local.has(id));
      const inCommon = new Set(common);
      const serverOrder = serverRef.current.map((b) => b.id).filter((id) => inCommon.has(id));
      const localOrder = [...local.keys()].filter((id) => inCommon.has(id));
      const peerMoved = common.join() !== serverOrder.join() && localOrder.join() === serverOrder.join();
      if (peerMoved) return false;

      for (const block of remote) {
        const was = server.get(block.id);
        const now = local.get(block.id);
        if (was && now && block.depth !== now.depth && now.depth === was.depth) return false;
        if (!was && !now && block.depth !== 0) return false;
      }

      const gone = [...local.keys()].filter((id) => server.has(id) && !remoteIds.has(id));
      if (gone.length > 0) live.removeBlocks(gone.map(editorIdOf));

      for (let i = 0; i < remote.length; i++) {
        const block = remote[i];
        if (!server.has(block.id) && !local.has(block.id)) insertRemote(live, remote, i);
      }

      for (const block of remote) {
        const was = server.get(block.id);
        const now = local.get(block.id);
        if (!was || !now) continue;
        const changed = block.kind !== was.kind || !attrsEqual(block.attrs, was.attrs);
        const untouched = now.kind === was.kind && attrsEqual(now.attrs, was.attrs);
        if (changed && untouched) {
          const [node] = toBlockNote([{ ...block, inline: now.inline }]);
          live.updateBlock(editorIdOf(block.id), { type: node.type, props: node.props });
        }
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- insertRemote reads refs only
    [editorIdOf, localBlocks],
  );

  /** Replaces the whole editor document, keeping the caret's scalar position. */
  const replaceAll = useCallback(
    (remote: EditorBlock[]) => {
      const live = editorRef.current;
      if (!live) return;
      const view = live.prosemirrorView;
      let caret: { block: string; at: Caret } | null = null;
      if (view) {
        for (const block of live.document) {
          const at = caretIn(view, block.id);
          if (at) caret = { block: backendIdOf(block.id), at };
        }
      }
      live.replaceBlocks(
        live.document.map((block) => block.id),
        toBlockNote(remote) as unknown as Record<string, unknown>[],
      );
      idMapRef.current = new Map();
      if (view && caret) placeCaret(view, caret.block, caret.at);
      setRevision((value) => value + 1);
    },
    [backendIdOf],
  );

  /** The node's document against the editor: structure first, then text. */
  const reconcile = useCallback(
    (remote: EditorBlock[], touched: Set<string>) => {
      if (!loadedRef.current || !isSynced()) {
        // The editor has not applied the load yet, so hand it the newer one.
        serverRef.current = remote;
        loadedRef.current = true;
        setContent(JSON.stringify(toBlockNote(remote)));
        return;
      }
      if (!applyRemoteStructure(remote)) {
        if (diffBlocks(serverRef.current, localBlocks()).length > 0) {
          // Our own block change is unsent; send it, then read again.
          dirtyRef.current = true;
          staleRef.current = true;
          return;
        }
        replaceAll(remote);
        serverRef.current = remote;
        return;
      }
      const previous = new Map(serverRef.current.map((b) => [b.id, b]));
      for (const block of remote) {
        const was = previous.get(block.id);
        if (was && !touched.has(block.id)) rebaseBlock(block.id, was.inline, block.inline);
      }
      serverRef.current = remote;
      // What still differs is the user's newer edit, which the next flush sends.
      if (structureOf(localBlocks()) !== structureOf(remote)) dirtyRef.current = true;
    },
    [applyRemoteStructure, isSynced, localBlocks, rebaseBlock, replaceAll],
  );

  const refreshWith = useCallback(
    async (touched: Set<string>) => {
      if (!client || !docId) return;
      try {
        const remote = backendBlocks(await client.getDocument({ doc: docId }));
        reconcile(remote, touched);
        setStatus((prev) => (prev === 'error' ? prev : 'saved'));
      } catch (cause) {
        setError(asError(cause));
      } finally {
        setLoading(false);
      }
    },
    [client, docId, reconcile],
  );
  const refresh = useCallback(() => refreshWith(new Set()), [refreshWith]);

  /** Runs one diff's calls in order, stopping at the first refused write. */
  const runCalls = useCallback(
    async (target: DocsClient, doc: string, calls: BlockCall[], progress: { done: number }): Promise<Outcome> => {
      const minted = new Map<string, string>();
      const touched = new Set<string>();
      const real = (ref: string | null) => (ref === null ? null : (minted.get(ref) ?? ref));
      const mint = (ref: string, id: string) => {
        minted.set(ref, id);
        if (isPlaceholder(ref)) idMapRef.current.set(ref.slice(4), id);
        touched.add(id);
      };
      const structural = calls.some((call) => call.call !== 'apply_delta');
      for (const call of calls) {
        switch (call.call) {
          case 'merge_blocks':
            await target.mergeBlocks({ doc, first: real(call.first) as string, second: real(call.second) as string });
            touched.add(real(call.first) as string);
            touched.add(real(call.second) as string);
            break;
          case 'split_block':
            touched.add(real(call.block) as string);
            mint(call.ref, await target.splitBlock({ doc, block: real(call.block) as string, at: call.at }));
            break;
          case 'insert_block':
            mint(call.ref, await target.insertBlock({ doc, after: real(call.after), kind: call.kind, depth: call.depth }));
            break;
          case 'delete_block':
            await target.deleteBlock({ doc, block: real(call.block) as string });
            touched.add(real(call.block) as string);
            break;
          case 'move_block':
            await target.moveBlock({ doc, block: real(call.block) as string, after: real(call.after) });
            touched.add(real(call.block) as string);
            break;
          case 'set_kind':
            await target.setKind({ doc, block: real(call.block) as string, kind: call.kind });
            touched.add(real(call.block) as string);
            break;
          case 'set_depth':
            await target.setDepth({ doc, block: real(call.block) as string, depth: call.depth });
            touched.add(real(call.block) as string);
            break;
          case 'set_attr':
            await target.setAttr({ doc, block: real(call.block) as string, key: call.key, value: call.value });
            touched.add(real(call.block) as string);
            break;
          case 'apply_delta': {
            const block = real(call.block) as string;
            // The generated ChangePayload is a tagged union; the contract
            // takes serde's untagged form, which is what `ops` already is.
            const result = await target.applyDeltaOn({
              doc,
              block,
              base: call.base,
              ops: call.ops as unknown as ChangePayload[],
            });
            if (result.applied && result.token) historyRef.current.record({ block, token: result.token });
            const was = serverBlock(block);
            if (was && !touched.has(block)) {
              const base = result.applied ? applyChanges(was.inline, call.ops) : was.inline;
              const spans = backendSpans(result.spans);
              rebaseBlock(block, base, spans);
              was.inline = spans;
            }
            if (!result.applied) return { refused: true, structural, touched };
            break;
          }
        }
        progress.done += 1;
      }
      return { refused: false, structural, touched };
    },
    [rebaseBlock],
  );

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current) return;
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void drainRef.current?.();
    }, delay);
  }, []);

  // False stops the drain loop: a transport failure defers to scheduleRetry.
  const flush = useCallback(async (): Promise<boolean> => {
    if (!client || !docId || !editorRef.current || !isSynced()) return true;
    const next = localBlocks();
    const calls = diffBlocks(serverRef.current, next);
    if (calls.length === 0) {
      setStatus('saved');
      return true;
    }
    setStatus('saving');
    const progress = { done: 0 };
    try {
      const outcome = await runCalls(client, docId, calls, progress);
      if (outcome.structural && outcome.refused) {
        resyncRef.current = true;
      } else if (outcome.structural) {
        // The node now holds this structure; tracking it stops a resend.
        serverRef.current = next.map((block) => {
          const id = backendIdOf(block.id);
          const held = serverBlock(id);
          return {
            ...block,
            id,
            inline: held && !outcome.touched.has(id) ? held.inline : block.inline,
          };
        });
        await refreshWith(outcome.touched);
      }
      if (outcome.refused) dirtyRef.current = true;
      setError(null);
      setStatus(outcome.refused ? 'saving' : 'saved');
      retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
      return true;
    } catch (cause) {
      dirtyRef.current = true;
      // Calls that did land left the node ahead of what we hold; read before resending.
      if (progress.done > 0) resyncRef.current = true;
      if (isTransportFailure(cause)) {
        setStatus('offline');
        scheduleRetry();
        return false;
      }
      setError(asError(cause));
      setStatus('error');
      resyncRef.current = true;
      return true;
    }
  }, [backendIdOf, client, docId, isSynced, localBlocks, refreshWith, runCalls, scheduleRetry]);

  const drain = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      while (dirtyRef.current || staleRef.current || resyncRef.current) {
        if (resyncRef.current) {
          resyncRef.current = false;
          await refreshWith(new Set(serverRef.current.map((b) => b.id)));
        } else if (dirtyRef.current) {
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
  }, [flush, refresh, refreshWith]);
  drainRef.current = drain;

  useEffect(() => {
    historyRef.current.reset(docId);
    idMapRef.current = new Map();
    serverRef.current = [];
    dirtyRef.current = false;
    staleRef.current = false;
    resyncRef.current = false;
    loadedRef.current = false;
    syncedRef.current = false;
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
      if (dirtyRef.current || inFlightRef.current) return;
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
    (_serialized: string) => {
      dirtyRef.current = true;
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
      const ran = direction === 'undo' ? history.undo(apply) : history.redo(apply);
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
    revision,
    backendIdOf,
  };
}
