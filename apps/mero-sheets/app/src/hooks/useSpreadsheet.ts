/**
 * useSpreadsheet — live data hook for the mero-sheets spreadsheet app.
 *
 * Wire pass: replaces the shell stubs with real SpreadsheetClient calls and
 * wires useSubscription for live CRDT sync across peers.
 *
 * Pattern:
 *  - useMemo creates the typed client when mero + contextId + executorPublicKey resolve.
 *  - refresh() fetches the whole workbook (get_all_cells) into a warm snapshot, then
 *    derives the active sheet's computed cells locally via the WASM recalc engine.
 *  - useSubscription re-reads what each context event changed (local + remote peers;
 *    see spreadsheet/events.ts), which reconciles the warm snapshot and retires
 *    confirmed overlay entries. Presence frames never trigger a read.
 *  - Cell writes (setCell/clearCell/setCellFormat/applyCellOps) paint optimistically
 *    through the pending overlay and rely on the subscription refresh to reconcile —
 *    they do NOT call refresh() directly. Sheet-level ops (initProject/createSheet/
 *    renameSheet/deleteSheet) still call refresh() directly after the write.
 *  - The node stores cells by row and column id, and formulas with references by
 *    id (see logic/crates/recalc/src/layout.rs). This hook is the boundary: callers
 *    see positions and formulas as typed, and it places cells and converts
 *    formulas through the engine, which holds every sheet's layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';
import { useStreamReconnect } from './useStreamReconnect';
import { SpreadsheetClient } from '../api/spreadsheet/SpreadsheetClient';
import type {
  Sheet, FunctionDef, Member, Project, NamedRange, SheetLayout, AxisOpPayload, ActivityEntry, Comment,
  NotedCell, NoteChangePayload,
} from '../api/spreadsheet/SpreadsheetClient';
import { AxisOp as AxisOpWire, CellOp as CellOpWire } from '../api/spreadsheet/SpreadsheetClient';
import { chunkOps, MAX_OPS_PER_APPLY, type CellOp } from '../spreadsheet/ops';
import { isNoop, mentionsIn, mergePlans, planFor, type Mention, type RefreshPlan } from '../spreadsheet/events';
import type { NoteOp, Span } from '../spreadsheet/notes';
import { newAxisId, positionOf, positionsBetween, type AxisEntry } from '../spreadsheet/axis';
import { applicable, invert, pushBounded, type CellState, type UndoEntry } from '../spreadsheet/undo';
import { rangeRef, type Rect } from '../spreadsheet/refs';
import {
  initEngine, engineReady, evaluate as engineEvaluate, functionCatalog,
  setStructure, visibleOrder, toStored, toDisplay,
} from '../engine/engine';
import {
  snapshotFromCells, retireOverlay, deriveSheetCells, diffComputed, cellKey,
  type GridCell, type Snapshot, type Overlay, type Placement,
} from '../engine/derive';

/** A cell as callers see it: placed at a position, formula in display form. */
export type Cell = GridCell;

/** Rows or columns. */
export type Axis = 'row' | 'col';

/** A cell op by id, raw value in stored form. */
type IdOp =
  | { kind: 'Set'; row_id: string; col_id: string; raw_value: string }
  | { kind: 'Format'; row_id: string; col_id: string; format: string }
  | { kind: 'Clear'; row_id: string; col_id: string };

/** How long events are gathered before one round of reads. */
const EVENT_COALESCE_MS = 60;

// Re-export domain types so components import from one place
export type { Sheet, FunctionDef, Member, Project, NamedRange, ActivityEntry, Comment, NotedCell };

// ── Hook interfaces ──────────────────────────────────────────────────────────

export interface UseSpreadsheetArgs {
  contextId: string | null;
  executorPublicKey: string | null;
  /** The sheet currently displayed — refresh() fetches only this sheet's cells. */
  activeSheetId: string | null;
}

export interface UseSpreadsheetReturn {
  sheets: Sheet[];
  cells: Cell[];
  functions: FunctionDef[];
  /**
   * Everyone who has named themselves in this spreadsheet. Keyed by the same id
   * a live cursor carries (see useSheetPresence), so it can be labelled.
   */
  members: Member[];
  /**
   * The project's own title, read from the contract. `init_project` has always
   * written it; until `get_project` existed nothing could read it back, which is
   * why the picker fell back to per-browser names nobody else could see.
   */
  project: Project | null;
  /**
   * The id THIS node writes under, straight from the contract (`whoami`).
   *
   * Asked rather than inferred: a member id is a DEVICE key and
   * `executorPublicKey` is a CONTEXT identity. Both are 64 hex, so comparing
   * them type-checks and is false forever — which showed the local user as a
   * stranger in their own spreadsheet.
   */
  selfId: string | null;
  /** True once `members` has been fetched at least once for this context. */
  membersLoaded: boolean;
  loading: boolean;
  /** True once the first refresh for the current context has completed. */
  loaded: boolean;
  /** True while ≥1 state-changing mutation is in flight (serialization queue non-empty). */
  mutating: boolean;
  error: Error | null;
  /** True when contextId + executorPublicKey are resolved and client is ready. */
  ready: boolean;
  // Project init (called once by the workspace creator after bootstrap)
  initProject: (name: string) => Promise<void>;
  /** Announce (or rename) this device under a chosen nickname. */
  joinAs: (nickname: string) => Promise<void>;
  // Sheet mutations
  createSheet: (name: string) => Promise<void>;
  renameSheet: (sheetId: string, newName: string) => Promise<void>;
  deleteSheet: (sheetId: string) => Promise<void>;
  // Cell mutations
  setCell: (sheetId: string, row: number, col: number, rawValue: string) => Promise<void>;
  clearCell: (sheetId: string, row: number, col: number) => Promise<void>;
  setCellFormat: (sheetId: string, row: number, col: number, format: string) => Promise<void>;
  applyCellOps: (sheetId: string, ops: CellOp[]) => Promise<void>;
  /** Insert `count` rows or columns before position `at`: one write each. */
  insertAxis: (sheetId: string, axis: Axis, at: number, count: number) => Promise<void>;
  /** Delete the rows or columns at these positions. */
  deleteAxis: (sheetId: string, axis: Axis, positions: number[]) => Promise<void>;
  /** Named ranges, targets in display form (`[sheet-id]!A1:B4`). */
  namedRanges: NamedRange[];
  /** Live comments, oldest first. */
  comments: Comment[];
  addComment: (sheetId: string, row: number, col: number, text: string, parent?: string) => Promise<void>;
  editComment: (id: string, text: string) => Promise<void>;
  resolveComment: (id: string, resolved: boolean) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  /** Comments by others that mention this user, newest last, until dismissed. */
  mentions: Mention[];
  dismissMention: (commentId: string) => void;
  /** Cells with a note, with the start of each. */
  notedCells: NotedCell[];
  /** A cell's note as formatted runs (empty when it has none). */
  loadNote: (sheetId: string, rowId: string, colId: string) => Promise<Span[]>;
  /** One note edit: text and formatting, as a delta. */
  editNote: (sheetId: string, rowId: string, colId: string, ops: NoteOp[]) => Promise<void>;
  /** The activity log for the last `days` days, newest first. */
  loadActivity: (days: number) => Promise<ActivityEntry[]>;
  /** Where a cell id sits now (`null` when its row/column is gone). */
  refOf: (sheetId: string, rowId: string, colId: string) => { row: number; col: number } | null;
  /** The ids at a position (`null` past the sheet's edge). */
  idsOf: (sheetId: string, row: number, col: number) => { row_id: string; col_id: string } | null;
  /** A stored raw value as shown: formulas by position, not id. */
  displayRaw: (sheetId: string, raw: string) => string;
  /** Undo / redo this user's own edits (see spreadsheet/undo.ts). */
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  defineName: (name: string, sheetId: string, rect: Rect) => Promise<void>;
  deleteName: (name: string) => Promise<void>;
  // Export
  exportAll: () => Promise<Sheet[]>;
  /** One sheet's cells, placed and computed from the warm store — used by download. */
  getSheetCells: (sheetId: string) => Cell[];
  // Function search (local filter)
  searchFunctions: (prefix: string) => FunctionDef[];
  refresh: () => Promise<void>;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useSpreadsheet({
  contextId,
  executorPublicKey,
  activeSheetId,
}: UseSpreadsheetArgs): UseSpreadsheetReturn {
  const { mero } = useMero();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [functions, setFunctions] = useState<FunctionDef[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // False until the first refresh for the current client resolves. Distinguishes
  // "not fetched yet" from "fetched and genuinely empty" — callers must not treat
  // an empty `sheets`/`cells` as authoritative until `loaded` is true.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pendingMutations, setPendingMutations] = useState(0);

  const snapshotRef = useRef<Snapshot>(new Map());
  const overlayRef = useRef<Overlay>(new Map());
  // The workbook structure, as the node stores it, mirrored into the engine.
  const layoutsRef = useRef<SheetLayout[]>([]);
  const namesRef = useRef<NamedRange[]>([]);
  const [names, setNames] = useState<NamedRange[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [notedCells, setNotedCells] = useState<NotedCell[]>([]);
  const applyStructureTo = useCallback((layouts: SheetLayout[], named: NamedRange[]) => {
    layoutsRef.current = layouts;
    namesRef.current = named;
    setStructure(layouts, named);
    setNames(named);
  }, []);
  const [engineTick, setEngineTick] = useState(0); // bump to re-derive after init

  useEffect(() => {
    void initEngine().then(() => setEngineTick((t) => t + 1));
  }, []);

  // Memoized typed client — null until mero + context + identity all resolve.
  const client = useMemo(
    () =>
      mero && contextId && executorPublicKey
        ? new SpreadsheetClient(mero, contextId)
        : null,
    [mero, contextId, executorPublicKey],
  );

  // Serialize state-changing rpc.execute calls. The node commits each mutation
  // as a full-state snapshot, so two mutations issued concurrently (e.g. a
  // sheet rename racing the setCell of a paste) clobber each other — the last to commit wins and silently drops the
  // other's write. Chaining every mutation through one promise guarantees they
  // apply strictly one at a time. Reads (refresh) stay off the queue.
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    setPendingMutations((n) => n + 1);
    const next = mutationQueue.current.then(op, op);
    mutationQueue.current = next.then(
      () => undefined,
      () => undefined,
    );
    next.then(
      () => setPendingMutations((n) => n - 1),
      () => setPendingMutations((n) => n - 1),
    );
    return next;
  }, []);

  // ── Refresh: fetch all sheets, their cells, and the roster ────────────────

  // The active sheet is read through a ref so `refresh`'s identity stays stable
  // across tab switches — switching sheets refetches only cells (the effect
  // below), never the sheet list / roster.
  const activeSheetIdRef = useRef(activeSheetId);
  activeSheetIdRef.current = activeSheetId;

  // The full sheet list read through a ref so the engine's `sheet_ids` matches the
  // node's exactly (the node builds sheet_ids from its whole sheet list, including
  // sheets with no cells yet). Missing an existing-but-empty sheet id would make
  // the client's engine return #REF! for cross-sheet refs the node computed fine.
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;

  // Derive the active sheet's cells from the warm store ⊕ overlay and paint them.
  // Before the engine is ready, fall back to the node computed values captured in
  // the snapshot (pre-WASM initial paint — no flash of raw formulas).
  const placement = (sheetId: string): Placement => ({
    order: visibleOrder(sheetId),
    toDisplay: (stored) => toDisplay(stored, sheetId),
  });

  // One sheet's cells, placed and computed. Before the engine is ready, the
  // node's computed values captured in the snapshot, at their legacy positions
  // (pre-WASM initial paint — no flash of raw formulas).
  const sheetCells = useCallback((sheetId: string): Cell[] => {
    if (!engineReady()) {
      return [...snapshotRef.current.values()]
        .filter((c) => c.sheet_id === sheetId && /^\d+$/.test(c.row_id) && /^\d+$/.test(c.col_id))
        .map((c) => ({ ...c, row: Number(c.row_id), col: Number(c.col_id) }));
    }
    const sheetIds = [...new Set([
      ...sheetsRef.current.map((s) => s.id),
      ...[...snapshotRef.current.values()].map((c) => c.sheet_id),
      ...[...overlayRef.current.values()].map((e) => e.sheet_id),
    ])];
    return deriveSheetCells(
      snapshotRef.current, overlayRef.current, sheetIds, sheetId, engineEvaluate, placement(sheetId),
    );
  }, []);

  // Derive the active sheet's cells from the warm store ⊕ overlay and paint them.
  const deriveAndSet = useCallback(() => {
    const active = activeSheetIdRef.current;
    if (!active) { setCells([]); return; }
    const derived = sheetCells(active);
    setCells(derived);
    if (import.meta.env.DEV && engineReady()) {
      const nodeActive = [...snapshotRef.current.values()].filter((c) => c.sheet_id === active);
      const bad = diffComputed(nodeActive, derived, visibleOrder(active));
      if (bad.length) console.error('[recalc] WASM/node computed-value disagreement at', bad, '— stale wasm artifact or engine-input mismatch');
    }
  }, [sheetCells]);

  // Apply local edits (by id, raw in stored form) to the overlay and repaint
  // immediately, before the node write.
  const applyOverlay = useCallback(
    (sheetId: string, edits: { row_id: string; col_id: string; raw_value?: string; format?: string; clear?: boolean }[]) => {
      for (const e of edits) {
        const key = cellKey(sheetId, e.row_id, e.col_id);
        const prev = overlayRef.current.get(key)
          ?? snapshotRef.current.get(key)
          ?? { raw_value: '', format: '' };
        overlayRef.current.set(key, {
          sheet_id: sheetId,
          row_id: e.row_id,
          col_id: e.col_id,
          raw_value: e.clear ? '' : e.raw_value ?? prev.raw_value,
          format: e.clear ? '' : e.format ?? prev.format,
        });
      }
      deriveAndSet();
    },
    [deriveAndSet],
  );

  /** The row and column id at a position, or null past the sheet's edge. */
  const idsAt = (sheetId: string, row: number, col: number) => {
    const order = visibleOrder(sheetId);
    const row_id = order.rows[row];
    const col_id = order.cols[col];
    return row_id !== undefined && col_id !== undefined ? { row_id, col_id } : null;
  };

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const [
        fetchedSheets, allCells,
        fetchedMembers, fetchedProject, me, layouts, named, fetchedComments, noted,
      ] = await Promise.all([
        client.listSheets(),
        client.getAllCells(),
        client.getMembers(),
        client.getProject(),
        client.whoami(),
        client.getLayouts(),
        client.getNamedRanges(),
        client.getComments(),
        client.getNotedCells(),
      ]);
      applyStructureTo(layouts, named);
      setComments(fetchedComments);
      setNotedCells(noted);
      snapshotRef.current = snapshotFromCells(allCells);
      overlayRef.current = retireOverlay(overlayRef.current, snapshotRef.current);
      setSheets(fetchedSheets.sort((a, b) => a.position - b.position));
      setMembers(fetchedMembers);
      setProject(fetchedProject);
      setSelfId(me);
      deriveAndSet();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
      setLoaded(true);
      setMembersLoaded(true);
    }
  }, [client, deriveAndSet, applyStructureTo]);

  // Reset the loaded flag whenever the client changes (new context) so callers
  // wait for that context's first fetch before acting on empty state.
  useEffect(() => {
    setLoaded(false);
    // The roster and the identity belong to the PREVIOUS context. Leaving them
    // in place would show the last spreadsheet's collaborators next to this
    // one's cursors for as long as the first fetch takes, and — worse — mark the
    // wrong row as "you".
    setMembersLoaded(false);
    setMembers([]);
    setProject(null);
    setSelfId(null);
  }, [client]);

  // Full reload when the context (client) changes.
  useEffect(() => { void refresh(); }, [refresh]);

  // Tab switch / engine init: re-derive the active sheet from the warm store.
  // No node round-trip — all sheets' inputs are already in snapshotRef.
  useEffect(() => {
    deriveAndSet();
  }, [activeSheetId, engineTick, deriveAndSet]);

  // The function help comes from the engine, so it lists exactly what evaluates.
  useEffect(() => {
    if (engineReady()) setFunctions(functionCatalog());
  }, [engineTick]);

  // Re-read only what an event changed (see spreadsheet/events.ts): a cell
  // write re-reads that sheet, a rename the sheet list, a new member the
  // roster. The active sheet is re-read alongside, so its node-computed values
  // (the pre-engine paint, and the dev agreement check) stay current when a
  // sheet it references changes.
  const applyPlan = useCallback(async (plan: Extract<RefreshPlan, { full: false }>) => {
    if (!client) return;
    const sheetIds = new Set(plan.sheets);
    const active = activeSheetIdRef.current;
    if (sheetIds.size > 0 && active) sheetIds.add(active);
    const ids = [...sheetIds];
    const [bySheet, fetchedSheets, fetchedMembers, layouts, named, fetchedComments, noted] = await Promise.all([
      Promise.all(ids.map((id) => client.getCells({ sheet_id: id }))),
      plan.sheetList ? client.listSheets() : null,
      plan.members ? client.getMembers() : null,
      plan.layouts ? client.getLayouts() : null,
      plan.names ? client.getNamedRanges() : null,
      plan.comments ? client.getComments() : null,
      plan.notes ? client.getNotedCells() : null,
    ]);
    if (fetchedComments) setComments(fetchedComments);
    if (noted) setNotedCells(noted);
    if (layouts || named) applyStructureTo(layouts ?? layoutsRef.current, named ?? namesRef.current);
    if (ids.length > 0) {
      const next = new Map(snapshotRef.current);
      for (const [key, c] of next) if (sheetIds.has(c.sheet_id)) next.delete(key);
      for (const c of bySheet.flat()) next.set(cellKey(c.sheet_id, c.row_id, c.col_id), c);
      snapshotRef.current = next;
      overlayRef.current = retireOverlay(overlayRef.current, next);
    }
    if (fetchedSheets) setSheets(fetchedSheets.sort((a, b) => a.position - b.position));
    if (fetchedMembers) setMembers(fetchedMembers);
    deriveAndSet();
  }, [client, deriveAndSet, applyStructureTo]);

  // Events are coalesced for a moment and read in one round; one round runs
  // at a time, and whatever arrives meanwhile is merged into the next.
  const pendingPlan = useRef<RefreshPlan | null>(null);
  const planTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planRunning = useRef(false);
  const runPlan = useCallback(async () => {
    planTimer.current = null;
    if (planRunning.current) return;
    const plan = pendingPlan.current;
    pendingPlan.current = null;
    if (!plan || isNoop(plan)) return;
    planRunning.current = true;
    try {
      if (plan.full) await refresh();
      else await applyPlan(plan).catch(() => refresh());
    } finally {
      planRunning.current = false;
      if (pendingPlan.current && !planTimer.current) {
        planTimer.current = setTimeout(() => void runPlan(), 0);
      }
    }
  }, [refresh, applyPlan]);
  const schedule = useCallback((plan: RefreshPlan | null) => {
    pendingPlan.current = mergePlans(pendingPlan.current, plan);
    if (pendingPlan.current && !planTimer.current) {
      planTimer.current = setTimeout(() => void runPlan(), EVENT_COALESCE_MS);
    }
  }, [runPlan]);
  useEffect(() => () => {
    if (planTimer.current) clearTimeout(planTimer.current);
    planTimer.current = null;
    pendingPlan.current = null;
  }, [client]);

  const selfIdRef = useRef(selfId);
  selfIdRef.current = selfId;
  useSubscription(contextId ? [contextId] : [], (event) => {
    schedule(planFor(event));
    const me = selfIdRef.current;
    const forMe = mentionsIn(event).filter((m) => me && m.author !== me && m.mentions.includes(me));
    if (forMe.length) setMentions((prev) => [...prev, ...forMe.filter((m) => !prev.some((p) => p.commentId === m.commentId))]);
  });
  useEffect(() => { setMentions([]); setComments([]); setNotedCells([]); }, [client]);
  // …and after the stream reconnects: nothing replays what changed while it was down.
  useStreamReconnect(() => schedule({ full: true }));

  // ── Mutations ─────────────────────────────────────────────────────────────

  const initProject = useCallback(async (name: string) => {
    if (!client) return;
    // A freshly-initialised project has zero sheets. The grid's formula bar is
    // disabled until an active sheet exists (`activeSheetId`), so without a
    // sheet the workspace opens read-only and you can't type in any cell.
    // Create a default blank sheet so the workspace is immediately editable;
    // it replicates to invited collaborators (the "default blank sheet within
    // 5s" contract).
    await enqueue(async () => {
      await client.initProject({ name });
      await client.createSheet({ name: 'Sheet 1' });
    });
    await refresh();
  }, [client, refresh, enqueue]);

  const joinAs = useCallback(async (nickname: string) => {
    if (!client) return;
    await enqueue(() => client.join({ nickname }));
    await refresh();
  }, [client, refresh, enqueue]);

  const createSheet = useCallback(async (name: string) => {
    if (!client) return;
    await enqueue(() => client.createSheet({ name }));
    await refresh();
  }, [client, refresh, enqueue]);

  const renameSheet = useCallback(async (sheetId: string, newName: string) => {
    if (!client) return;
    await enqueue(() => client.renameSheet({ sheet_id: sheetId, new_name: newName }));
    await refresh();
  }, [client, refresh, enqueue]);

  const deleteSheet = useCallback(async (sheetId: string) => {
    if (!client) return;
    await enqueue(() => client.deleteSheet({ sheet_id: sheetId }));
    await refresh();
  }, [client, refresh, enqueue]);

  // ── Undo ──────────────────────────────────────────────────────────────
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });
  const syncDepth = () => setDepth({ undo: undoStack.current.length, redo: redoStack.current.length });
  const record = useCallback((entry: UndoEntry) => {
    undoStack.current = pushBounded(undoStack.current, entry);
    redoStack.current = [];
    setDepth({ undo: undoStack.current.length, redo: 0 });
  }, []);
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    syncDepth();
  }, [client]);

  /** A cell's current raw value (stored form) and format, overlay first. */
  const stateAt = (sheetId: string, rowId: string, colId: string): CellState => {
    const key = cellKey(sheetId, rowId, colId);
    const e = overlayRef.current.get(key) ?? snapshotRef.current.get(key);
    return { raw_value: e?.raw_value ?? '', format: e?.format ?? '' };
  };

  // Every cell write goes through here, by id with raw values in stored form:
  // paint through the overlay, optionally record the undo step, then send in
  // node-sized commits under one queue slot.
  const writeCells = useCallback(
    async (sheetId: string, ops: IdOp[], track: boolean) => {
      if (!client || ops.length === 0) return;
      if (track) {
        const changes = new Map<string, { row_id: string; col_id: string; before: CellState; after: CellState }>();
        for (const op of ops) {
          const key = cellKey(sheetId, op.row_id, op.col_id);
          const prev = changes.get(key)
            ?? { row_id: op.row_id, col_id: op.col_id, before: stateAt(sheetId, op.row_id, op.col_id), after: stateAt(sheetId, op.row_id, op.col_id) };
          const after = op.kind === 'Set' ? { ...prev.after, raw_value: op.raw_value }
            : op.kind === 'Format' ? { ...prev.after, format: op.format }
            : { raw_value: '', format: '' };
          changes.set(key, { ...prev, after });
        }
        record({ kind: 'cells', sheetId, changes: [...changes.values()] });
      }
      applyOverlay(sheetId, ops.map((op) =>
        op.kind === 'Set' ? { row_id: op.row_id, col_id: op.col_id, raw_value: op.raw_value }
        : op.kind === 'Format' ? { row_id: op.row_id, col_id: op.col_id, format: op.format }
        : { row_id: op.row_id, col_id: op.col_id, clear: true },
      ));
      const wire = ops.map((op) =>
        op.kind === 'Set'
          ? CellOpWire.Set({ row_id: op.row_id, col_id: op.col_id, raw_value: op.raw_value })
          : op.kind === 'Format'
            ? CellOpWire.Format({ row_id: op.row_id, col_id: op.col_id, format: op.format })
            : CellOpWire.Clear({ row_id: op.row_id, col_id: op.col_id }));
      await enqueue(async () => {
        for (const chunk of chunkOps(wire)) {
          await client.applyCellOps({ sheet_id: sheetId, ops: chunk });
        }
      });
      // No refresh() here — the subscription refresh reconciles + retires.
    },
    [client, applyOverlay, enqueue, record],
  );

  const setCell = useCallback(
    async (sheetId: string, row: number, col: number, rawValue: string) => {
      const at = idsAt(sheetId, row, col);
      if (at) await writeCells(sheetId, [{ kind: 'Set', ...at, raw_value: toStored(rawValue, sheetId) }], true);
    },
    [writeCells],
  );

  const clearCell = useCallback(async (sheetId: string, row: number, col: number) => {
    const at = idsAt(sheetId, row, col);
    if (at) await writeCells(sheetId, [{ kind: 'Clear', ...at }], true);
  }, [writeCells]);

  const setCellFormat = useCallback(
    async (sheetId: string, row: number, col: number, format: string) => {
      const at = idsAt(sheetId, row, col);
      if (at) await writeCells(sheetId, [{ kind: 'Format', ...at, format }], true);
    },
    [writeCells],
  );

  const applyCellOps = useCallback(
    async (sheetId: string, ops: CellOp[]) => {
      // Positions and typed formulas → ids and stored formulas, once.
      const byId = ops.flatMap((op): IdOp[] => {
        const at = idsAt(sheetId, op.row, op.col);
        if (!at) return [];
        return [op.kind === 'Set'
          ? { kind: 'Set', ...at, raw_value: toStored(op.raw_value, sheetId) }
          : op.kind === 'Format'
            ? { kind: 'Format', ...at, format: op.format }
            : { kind: 'Clear', ...at }];
      });
      await writeCells(sheetId, byId, true);
    },
    [writeCells],
  );

  // ── Rows and columns ─────────────────────────────────────────────────────

  /** A sheet's entries on one axis, as the engine holds them. */
  const axisEntries = (sheetId: string, axis: Axis): AxisEntry[] => {
    const l = layoutsRef.current.find((x) => x.sheet_id === sheetId);
    return (axis === 'row' ? l?.rows : l?.cols) ?? [];
  };

  /** Add entries to the local structure at once, then send the ops. */
  const commitAxis = useCallback(
    async (sheetId: string, axis: Axis, added: AxisEntry[], ops: AxisOpPayload[], track: boolean) => {
      if (!client || ops.length === 0) return;
      if (track) {
        record({ kind: 'axis', sheetId, axis, ids: added.map((e) => e.id), inserted: !added[0]?.deleted });
      }
      const layouts = layoutsRef.current.some((l) => l.sheet_id === sheetId)
        ? layoutsRef.current
        : [...layoutsRef.current, { sheet_id: sheetId, rows: [], cols: [] }];
      applyStructureTo(
        layouts.map((l) => {
          if (l.sheet_id !== sheetId) return l;
          const key = axis === 'row' ? 'rows' : 'cols';
          const kept = l[key].filter((e) => !added.some((a) => a.id === e.id));
          return { ...l, [key]: [...kept, ...added] };
        }),
        namesRef.current,
      );
      deriveAndSet();
      await enqueue(async () => {
        for (let i = 0; i < ops.length; i += MAX_OPS_PER_APPLY) {
          await client.applyAxisOps({ sheet_id: sheetId, ops: ops.slice(i, i + MAX_OPS_PER_APPLY) });
        }
      });
    },
    [client, enqueue, deriveAndSet, applyStructureTo, record],
  );

  const insertAxis = useCallback(
    async (sheetId: string, axis: Axis, at: number, count: number) => {
      const order = visibleOrder(sheetId);
      const ids = axis === 'row' ? order.rows : order.cols;
      const entries = axisEntries(sheetId, axis);
      const before = at > 0 ? positionOf(ids[at - 1], entries) ?? '' : '';
      const after = at < ids.length ? positionOf(ids[at], entries) : null;
      const added = positionsBetween(before, after, count)
        .map((pos) => ({ id: newAxisId(), pos, deleted: false }));
      const ops = added.map(({ id, pos }) =>
        axis === 'row' ? AxisOpWire.InsertRow({ id, pos }) : AxisOpWire.InsertCol({ id, pos }));
      await commitAxis(sheetId, axis, added, ops, true);
    },
    [commitAxis],
  );

  const deleteAxis = useCallback(
    async (sheetId: string, axis: Axis, positions: number[]) => {
      const order = visibleOrder(sheetId);
      const ids = axis === 'row' ? order.rows : order.cols;
      const entries = axisEntries(sheetId, axis);
      const added = [...new Set(positions)].flatMap((p) => {
        const id = ids[p];
        const pos = id === undefined ? null : positionOf(id, entries);
        return id === undefined || pos === null ? [] : [{ id, pos, deleted: true }];
      });
      const ops = added.map(({ id }) =>
        axis === 'row' ? AxisOpWire.DeleteRow({ id }) : AxisOpWire.DeleteCol({ id }));
      await commitAxis(sheetId, axis, added, ops, true);
    },
    [commitAxis],
  );

  /** Delete (`deleted`) or restore rows/columns by id, as an undo or redo. */
  const setAxisDeleted = useCallback(
    async (sheetId: string, axis: Axis, ids: string[], deleted: boolean) => {
      const entries = axisEntries(sheetId, axis);
      const changed = ids.flatMap((id) => {
        const pos = positionOf(id, entries);
        return pos === null ? [] : [{ id, pos, deleted }];
      });
      const ops = changed.map(({ id }) => deleted
        ? (axis === 'row' ? AxisOpWire.DeleteRow({ id }) : AxisOpWire.DeleteCol({ id }))
        : (axis === 'row' ? AxisOpWire.RestoreRow({ id }) : AxisOpWire.RestoreCol({ id })));
      await commitAxis(sheetId, axis, changed, ops, false);
    },
    [commitAxis],
  );

  /**
   * Take `entry` back to its "before" side, where nobody else has changed it
   * since, and return the step that was actually taken (for the other stack).
   */
  const applyEntry = useCallback(async (entry: UndoEntry): Promise<UndoEntry> => {
    if (entry.kind === 'axis') {
      await setAxisDeleted(entry.sheetId, entry.axis, entry.ids, entry.inserted);
      return invert(entry);
    }
    const changes = applicable(entry.changes, (r, c) => stateAt(entry.sheetId, r, c));
    const ops = changes.flatMap((c): IdOp[] =>
      c.before.raw_value === '' && c.before.format === ''
        ? [{ kind: 'Clear', row_id: c.row_id, col_id: c.col_id }]
        : [
            { kind: 'Set', row_id: c.row_id, col_id: c.col_id, raw_value: c.before.raw_value },
            { kind: 'Format', row_id: c.row_id, col_id: c.col_id, format: c.before.format },
          ]);
    await writeCells(entry.sheetId, ops, false);
    return invert({ ...entry, changes });
  }, [setAxisDeleted, writeCells]);

  const undo = useCallback(async () => {
    const entry = undoStack.current[undoStack.current.length - 1];
    if (!entry) return;
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = pushBounded(redoStack.current, await applyEntry(entry));
    syncDepth();
  }, [applyEntry]);

  const redo = useCallback(async () => {
    const entry = redoStack.current[redoStack.current.length - 1];
    if (!entry) return;
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = pushBounded(undoStack.current, await applyEntry(entry));
    syncDepth();
  }, [applyEntry]);

  // ── Named ranges ─────────────────────────────────────────────────────────

  const defineName = useCallback(
    async (name: string, sheetId: string, rect: Rect) => {
      if (!client) return;
      const display = `=[${sheetId}]!${rangeRef({ row: rect.top, col: rect.left }, { row: rect.bottom, col: rect.right })}`;
      const target = toStored(display, sheetId).slice(1);
      await enqueue(() => client.setNamedRange({ name, target }));
      applyStructureTo(layoutsRef.current, [
        ...namesRef.current.filter((n) => n.name.toUpperCase() !== name.toUpperCase()),
        { name, target },
      ]);
      deriveAndSet();
    },
    [client, enqueue, applyStructureTo, deriveAndSet],
  );

  const deleteName = useCallback(
    async (name: string) => {
      if (!client) return;
      await enqueue(() => client.deleteNamedRange({ name }));
      applyStructureTo(layoutsRef.current, namesRef.current.filter((n) => n.name.toUpperCase() !== name.toUpperCase()));
      deriveAndSet();
    },
    [client, enqueue, applyStructureTo, deriveAndSet],
  );

  // Targets in display form, for the names list. Computed each render: a
  // handful of names, and the conversion depends on the engine having loaded.
  const namedRanges = names.map((n) => {
    const sheet = /^\[([^\]]+)\]!/.exec(n.target)?.[1] ?? activeSheetId ?? '';
    return { name: n.name, target: toDisplay(`=${n.target}`, sheet).slice(1) };
  });

  const exportAll = useCallback(async (): Promise<Sheet[]> => {
    if (!client) return sheets;
    return client.exportAll();
  }, [client, sheets]);

  const getSheetCells = useCallback((sheetId: string) => sheetCells(sheetId), [sheetCells]);

  const addComment = useCallback(
    async (sheetId: string, row: number, col: number, text: string, parent = '') => {
      const at = idsAt(sheetId, row, col);
      if (!client || !at) return;
      await enqueue(() => client.addComment({ sheet_id: sheetId, ...at, text, parent }));
      setComments(await client.getComments());
    },
    [client, enqueue],
  );
  const commentAction = useCallback(
    async (write: () => Promise<unknown>) => {
      if (!client) return;
      await enqueue(write);
      setComments(await client.getComments());
    },
    [client, enqueue],
  );
  const editComment = useCallback(
    (id: string, text: string) => commentAction(() => client!.editComment({ id, text })),
    [client, commentAction],
  );
  const resolveComment = useCallback(
    (id: string, resolved: boolean) => commentAction(() => client!.setCommentResolved({ id, resolved })),
    [client, commentAction],
  );
  const deleteComment = useCallback(
    (id: string) => commentAction(() => client!.deleteComment({ id })),
    [client, commentAction],
  );
  const dismissMention = useCallback(
    (commentId: string) => setMentions((prev) => prev.filter((m) => m.commentId !== commentId)),
    [],
  );

  const loadNote = useCallback(
    async (sheetId: string, rowId: string, colId: string): Promise<Span[]> => {
      if (!client) return [];
      const spans = await client.getNote({ sheet_id: sheetId, row_id: rowId, col_id: colId });
      // An unformatted run comes without `attributes` (the contract skips an
      // empty map), whatever the generated type says.
      return spans.map((s) => ({ text: s.text, attributes: s.attributes ?? {} }));
    },
    [client],
  );
  const editNote = useCallback(
    async (sheetId: string, rowId: string, colId: string, ops: NoteOp[]) => {
      if (!client || ops.length === 0) return;
      // `edit_note` takes Quill's untagged delta shape; the generated type
      // models the enum as tagged, which is not what the contract reads.
      const wire = ops as unknown as NoteChangePayload[];
      await enqueue(() => client.editNote({ sheet_id: sheetId, row_id: rowId, col_id: colId, ops: wire }));
      setNotedCells(await client.getNotedCells());
    },
    [client, enqueue],
  );

  const loadActivity = useCallback(async (days: number): Promise<ActivityEntry[]> => {
    if (!client) return [];
    // Nanoseconds; a float's precision loss here is well under a second.
    const since = (Date.now() - days * 86_400_000) * 1_000_000;
    return client.getActivity({ since, limit: 300 });
  }, [client]);

  const refOf = useCallback((sheetId: string, rowId: string, colId: string) => {
    const order = visibleOrder(sheetId);
    const row = order.rows.indexOf(rowId);
    const col = order.cols.indexOf(colId);
    return row < 0 || col < 0 ? null : { row, col };
  }, []);

  const searchFunctions = useCallback(
    (prefix: string): FunctionDef[] => {
      if (!prefix) return functions;
      const upper = prefix.toUpperCase();
      return functions.filter((f) => f.name.startsWith(upper));
    },
    [functions],
  );

  return {
    sheets,
    cells,
    functions,
    members,
    membersLoaded,
    project,
    selfId,
    loading,
    loaded,
    mutating: pendingMutations > 0,
    error,
    ready: client !== null,
    initProject,
    joinAs,
    createSheet,
    renameSheet,
    deleteSheet,
    setCell,
    clearCell,
    setCellFormat,
    applyCellOps,
    insertAxis,
    deleteAxis,
    namedRanges,
    undo,
    redo,
    canUndo: depth.undo > 0,
    canRedo: depth.redo > 0,
    defineName,
    deleteName,
    exportAll,
    getSheetCells,
    comments,
    addComment,
    editComment,
    resolveComment,
    deleteComment,
    mentions,
    dismissMention,
    notedCells,
    loadNote,
    editNote,
    loadActivity,
    refOf,
    idsOf: idsAt,
    displayRaw: (sheetId: string, raw: string) => toDisplay(raw, sheetId),
    searchFunctions,
    refresh,
  };
}
