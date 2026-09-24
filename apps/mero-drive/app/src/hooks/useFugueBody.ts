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
  changedRange,
  fromBlockNote,
  toBlockNote,
  type BlockNoteBlock,
} from '@/lib/rich/blocknote';
import { attrsEqual } from '@/lib/rich/attributes';
import { inlineOffset, posAt, scalarAt } from '@/lib/rich/cursors';
import { diffSpans, insertAt, spansToInline, type AttrSpan, type Change } from '@/lib/rich/delta';
import { parseRichEvents } from '@/lib/rich/events';
import { applyChanges, moveInserts, transform, transformPosition } from '@/lib/rich/ot';
import { isTransportFailure } from '@/lib/rich/transport';
import {
  blockGeometry,
  type DocNode,
} from '@/components/editor/presence/geometry';
import {
  applyRemoteText,
  domSelection,
  flushPendingInput,
  keepSelection,
  type RemoteTextEditor,
} from '@/components/editor/remoteText';
import type { SaveStatus } from '@/components/editor/types';
import { isContextEvent } from './useContextEvents';
import { useRetry } from './useRetry';

const FLUSH_DEBOUNCE_MS = 50; // a few keystrokes per write; correctness does not depend on it
const REFRESH_DEBOUNCE_MS = 50; // coalesces a typing peer's event burst
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
  readonly pmSchema?: RemoteTextEditor['pmSchema'];
  transact?: RemoteTextEditor['transact'];
  undo?(): boolean;
  redo?(): boolean;
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
  /** The backend id of a block the editor knows by its own id, and back. */
  backendIdOf: (editorId: string) => string;
  editorIdOf: (backendId: string) => string;
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
  return { anchor: scalarAt(geometry, anchor), head: scalarAt(geometry, head) };
}

function placeCaret(view: EditorView, editorId: string, caret: Caret): void {
  const geometry = blockGeometry(view.state.doc as unknown as DocNode, editorId);
  if (!geometry) return;
  const { doc } = view.state;
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(doc, posAt(geometry, caret.anchor), posAt(geometry, caret.head)),
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
  // Per block, the gap after this client's last write and where it sits in serverRef.
  const anchorsRef = useRef(new Map<string, { token: string; pos: number }>());
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
  const drainRef = useRef<(() => Promise<void>) | null>(null);
  const { schedule: scheduleRetry, reset: resetRetry } = useRetry(
    () => void drainRef.current?.(),
  );

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

  /** Runs a peer's block-level change outside the user's undo history. */
  const asPeer = useCallback((apply: (live: BodyEditor) => void) => {
    const live = editorRef.current;
    if (!live) return;
    flushPendingInput(live.prosemirrorView);
    if (!live.transact) return apply(live);
    const before = domSelection(live.prosemirrorView);
    live.transact((tr) => {
      tr.setMeta('addToHistory', false);
      apply(live);
      keepSelection(tr, before);
    });
  }, []);

  /** `ops` into one editor block as steps; a whole-block replace is the fallback. */
  const replaceInline = useCallback(
    (editorId: string, spans: AttrSpan[], ops: Change[]) => {
      const live = editorRef.current;
      if (!live) return;
      if (live.pmSchema && live.transact && applyRemoteText(live as RemoteTextEditor, editorId, ops)) {
        return;
      }
      const view = live.prosemirrorView;
      const caret = view ? caretIn(view, editorId) : null;
      asPeer((peer) => peer.updateBlock(editorId, { content: spansToInline(spans) }));
      if (view && caret) {
        placeCaret(view, editorId, {
          anchor: transformPosition(ops, caret.anchor),
          head: transformPosition(ops, caret.head),
        });
      }
    },
    [asPeer],
  );

  /**
   * A peer moved one block from `base` to `remote`; carry that into the editor.
   * `anchorAt` is where a refused write's anchor sits in `remote`.
   */
  const rebaseBlock = useCallback(
    (backendId: string, base: AttrSpan[], remote: AttrSpan[], anchorAt: number | null = null) => {
      const remoteChange = diffSpans(base, remote, { keepShared: true });
      if (remoteChange.length === 0) return;
      // Read pending input before the editor is diffed, or the diff misses it.
      flushPendingInput(editorRef.current?.prosemirrorView);
      const editorId = editorIdOf(backendId);
      const local = localBlocks().find((block) => block.id === backendId);
      if (!local) return;
      const anchor = anchorsRef.current.get(backendId);
      const typed = anchor ? insertAt(base, local.inline, anchor.pos) : null;
      if (anchor && typed && anchorAt !== null) {
        const moved = moveInserts(typed, anchorAt);
        const target = applyChanges(remote, moved.ops);
        const view = editorRef.current?.prosemirrorView;
        const typing = view ? caretIn(view, editorId) !== null : false;
        replaceInline(editorId, target, diffSpans(local.inline, target, { keepShared: true }));
        if (view && typing) placeCaret(view, editorId, { anchor: moved.end, head: moved.end });
        anchor.pos = anchorAt;
      } else {
        const incoming = transform(typed ?? diffSpans(base, local.inline), remoteChange, true);
        if (anchor) anchor.pos = transformPosition(remoteChange, anchor.pos);
        if (incoming.length === 0) return;
        replaceInline(editorId, applyChanges(local.inline, incoming), incoming);
      }
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
      if (gone.length > 0) asPeer((peer) => peer.removeBlocks(gone.map(editorIdOf)));

      for (let i = 0; i < remote.length; i++) {
        const block = remote[i];
        if (!server.has(block.id) && !local.has(block.id)) asPeer((peer) => insertRemote(peer, remote, i));
      }

      for (const block of remote) {
        const was = server.get(block.id);
        const now = local.get(block.id);
        if (!was || !now) continue;
        const changed = block.kind !== was.kind || !attrsEqual(block.attrs, was.attrs);
        const untouched = now.kind === was.kind && attrsEqual(now.attrs, was.attrs);
        if (changed && untouched) {
          const [node] = toBlockNote([{ ...block, inline: now.inline }]);
          asPeer((peer) => peer.updateBlock(editorIdOf(block.id), { type: node.type, props: node.props }));
        }
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- insertRemote reads refs only
    [asPeer, editorIdOf, localBlocks],
  );

  /** Moves the editor to `remote` by replacing only the top-level blocks that
   *  differ, keeping the caret's scalar position. */
  const replaceChanged = useCallback(
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
      const target = toBlockNote(remote.map((block) => ({ ...block, id: editorIdOf(block.id) })));
      asPeer((peer) => {
        const { at, remove, insert } = changedRange(peer.document, target);
        const ids = remove.map((block) => block.id);
        const nodes = insert as unknown as Record<string, unknown>[];
        if (ids.length > 0) peer.replaceBlocks(ids, nodes);
        else if (nodes.length > 0) {
          peer.insertBlocks(nodes, peer.document[Math.max(at - 1, 0)].id, at > 0 ? 'after' : 'before');
        }
      });
      anchorsRef.current.clear();
      const present = new Set(fromBlockNote(live.document).map((block) => block.id));
      for (const editorId of [...idMapRef.current.keys()]) {
        if (!present.has(editorId)) idMapRef.current.delete(editorId);
      }
      if (view && caret) placeCaret(view, caret.block, caret.at);
      setRevision((value) => value + 1);
    },
    [asPeer, backendIdOf, editorIdOf],
  );

  /** The node's document against the editor: structure first, then text. */
  const reconcile = useCallback(
    (remote: EditorBlock[], touched: Set<string>) => {
      flushPendingInput(editorRef.current?.prosemirrorView);
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
        replaceChanged(remote);
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
    [applyRemoteStructure, isSynced, localBlocks, rebaseBlock, replaceChanged],
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
      // A structural write can move text between blocks, so no anchor position is trusted past it.
      if (structural) anchorsRef.current.clear();
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
            const was = serverBlock(block);
            const anchor = anchorsRef.current.get(block);
            const ops =
              (was && anchor && insertAt(was.inline, applyChanges(was.inline, call.ops), anchor.pos)) ?? call.ops;
            // The generated ChangePayload is a tagged union; the contract
            // takes serde's untagged form, which is what `ops` already is.
            const result = await target.applyDeltaOn({
              doc,
              block,
              base: call.base,
              ops: ops as unknown as ChangePayload[],
              anchor: anchor?.token ?? null,
            });
            if (was && !touched.has(block)) {
              const base = result.applied ? applyChanges(was.inline, ops) : was.inline;
              const spans = backendSpans(result.spans);
              rebaseBlock(block, base, spans, result.applied ? null : result.anchor_pos);
              was.inline = spans;
            }
            if (result.anchor !== null && result.anchor_pos !== null) {
              anchorsRef.current.set(block, { token: result.anchor, pos: result.anchor_pos });
            } else anchorsRef.current.delete(block);
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
        // Every call landed, so the node holds exactly what was diffed; tracking
        // that stops a resend and lets the re-read rebase a peer's edit into it.
        serverRef.current = next.map((block) => ({ ...block, id: backendIdOf(block.id) }));
        await refreshWith(new Set());
      }
      if (outcome.refused) dirtyRef.current = true;
      setError(null);
      setStatus(outcome.refused ? 'saving' : 'saved');
      resetRetry();
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
  }, [backendIdOf, client, docId, isSynced, localBlocks, refreshWith, resetRetry, runCalls, scheduleRetry]);

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
    idMapRef.current = new Map();
    anchorsRef.current = new Map();
    serverRef.current = [];
    dirtyRef.current = false;
    staleRef.current = false;
    resyncRef.current = false;
    loadedRef.current = false;
    syncedRef.current = false;
    resetRetry();
    setContent(undefined);
    setLoading(true);
    if (!client || !docId) return;
    void refresh();
  }, [client, docId, refresh, resetRetry]);

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

  // One history for the buttons and the keyboard: the editor's own, which
  // holds only this user's edits and groups a typing burst into one step.
  const undo = useCallback(() => void editorRef.current?.undo?.(), []);
  const redo = useCallback(() => void editorRef.current?.redo?.(), []);

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
    editorIdOf,
  };
}
