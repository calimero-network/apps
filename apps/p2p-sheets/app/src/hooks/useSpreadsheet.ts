/**
 * useSpreadsheet — live data hook for the p2p-sheets spreadsheet app.
 *
 * Wire pass: replaces the shell stubs with real SpreadsheetClient calls and
 * wires useSubscription for live CRDT sync across peers.
 *
 * Pattern:
 *  - useMemo creates the typed client when mero + contextId + executorPublicKey resolve.
 *  - refresh() fetches the whole workbook (get_all_cells) into a warm snapshot, then
 *    derives the active sheet's computed cells locally via the WASM recalc engine.
 *  - useSubscription re-fetches on every context sync event (local + remote peers),
 *    which reconciles the warm snapshot and retires confirmed overlay entries.
 *  - Cell writes (setCell/clearCell/setCellFormat/applyCellOps) paint optimistically
 *    through the pending overlay and rely on the subscription refresh to reconcile —
 *    they do NOT call refresh() directly. Sheet-level ops (initProject/createSheet/
 *    renameSheet/deleteSheet) still call refresh() directly after the write.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';
import { SpreadsheetClient } from '../api/spreadsheet/SpreadsheetClient';
import type { Sheet, Cell, Cursor, FunctionDef, CellOp } from '../api/spreadsheet/SpreadsheetClient';
import { initEngine, engineReady, evaluate as engineEvaluate } from '../engine/engine';
import {
  snapshotFromCells, retireOverlay, deriveActiveCells, diffComputed, cellKey,
  type Snapshot, type Overlay,
} from '../engine/derive';

// Re-export domain types so components import from one place
export type { Sheet, Cell, Cursor, FunctionDef };

// ── Built-in function reference (static fallback) ────────────────────────────
export const BUILTIN_FUNCTIONS: FunctionDef[] = [
  {
    name: 'SUM',
    syntax: 'SUM(range)',
    description: 'Adds all numbers in a range',
    example: '=SUM(A1:A10)',
  },
  {
    name: 'AVERAGE',
    syntax: 'AVERAGE(range)',
    description: 'Returns the average of numbers in a range',
    example: '=AVERAGE(B1:B5)',
  },
  {
    name: 'MIN',
    syntax: 'MIN(range)',
    description: 'Returns the smallest number in a range',
    example: '=MIN(C1:C10)',
  },
  {
    name: 'MAX',
    syntax: 'MAX(range)',
    description: 'Returns the largest number in a range',
    example: '=MAX(D1:D10)',
  },
  {
    name: 'COUNT',
    syntax: 'COUNT(range)',
    description: 'Counts the number of cells with numeric values',
    example: '=COUNT(A1:A20)',
  },
  {
    name: 'IF',
    syntax: 'IF(condition, value_if_true, value_if_false)',
    description: 'Returns one value if a condition is true, another if false',
    example: '=IF(A1>10, "High", "Low")',
  },
];

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
  cursors: Cursor[];
  functions: FunctionDef[];
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
  // Sheet mutations
  createSheet: (name: string) => Promise<void>;
  renameSheet: (sheetId: string, newName: string) => Promise<void>;
  deleteSheet: (sheetId: string) => Promise<void>;
  // Cell mutations
  setCell: (sheetId: string, row: number, col: number, rawValue: string) => Promise<void>;
  clearCell: (sheetId: string, row: number, col: number) => Promise<void>;
  setCellFormat: (sheetId: string, row: number, col: number, format: string) => Promise<void>;
  applyCellOps: (sheetId: string, ops: CellOp[]) => Promise<void>;
  // Cursor (fire-and-forget)
  updateCursor: (sheetId: string, row: number, col: number) => Promise<void>;
  // Export
  exportAll: () => Promise<Sheet[]>;
  /** Fetch one sheet's cells on demand (off the mutation queue) — used by download. */
  getSheetCells: (sheetId: string) => Promise<Cell[]>;
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
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [functions, setFunctions] = useState<FunctionDef[]>(BUILTIN_FUNCTIONS);
  const [loading, setLoading] = useState(false);
  // False until the first refresh for the current client resolves. Distinguishes
  // "not fetched yet" from "fetched and genuinely empty" — callers must not treat
  // an empty `sheets`/`cells` as authoritative until `loaded` is true.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pendingMutations, setPendingMutations] = useState(0);

  const snapshotRef = useRef<Snapshot>(new Map());
  const overlayRef = useRef<Overlay>(new Map());
  const [engineTick, setEngineTick] = useState(0); // bump to re-derive after init

  useEffect(() => {
    void initEngine().then(() => setEngineTick((t) => t + 1));
  }, []);

  // Memoized typed client — null until mero + context + identity all resolve.
  const client = useMemo(
    () =>
      mero && contextId && executorPublicKey
        ? new SpreadsheetClient(mero, contextId, executorPublicKey)
        : null,
    [mero, contextId, executorPublicKey],
  );

  // Serialize state-changing rpc.execute calls. The node commits each mutation
  // as a full-state snapshot, so two mutations issued concurrently (e.g. the
  // fire-and-forget updateCursor from a cell selection racing the setCell of a
  // paste) clobber each other — the last to commit wins and silently drops the
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

  // ── Refresh: fetch all sheets, their cells, cursors, and functions ────────

  // The active sheet is read through a ref so `refresh`'s identity stays stable
  // across tab switches — switching sheets refetches only cells (the effect
  // below), never the sheet list / cursors / functions.
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
  const deriveAndSet = useCallback(() => {
    const active = activeSheetIdRef.current;
    if (!active) { setCells([]); return; }
    if (!engineReady()) {
      setCells([...snapshotRef.current.values()].filter((c) => c.sheet_id === active));
      return;
    }
    const sheetIds = [...new Set([
      ...sheetsRef.current.map((s) => s.id),
      ...[...snapshotRef.current.values()].map((c) => c.sheet_id),
      ...[...overlayRef.current.values()].map((e) => e.sheet_id),
    ])];
    const derived = deriveActiveCells(
      snapshotRef.current, overlayRef.current, sheetIds, active, engineEvaluate,
    );
    setCells(derived);
    if (import.meta.env.DEV) {
      const nodeActive = [...snapshotRef.current.values()].filter((c) => c.sheet_id === active);
      const bad = diffComputed(nodeActive, derived);
      if (bad.length) console.error('[recalc] WASM/node computed-value disagreement at', bad, '— stale wasm artifact or engine-input mismatch');
    }
  }, []);

  // Apply local ops to the overlay and repaint immediately (before the node write).
  const applyOverlay = useCallback(
    (sheetId: string, edits: { row: number; col: number; raw_value?: string; format?: string; clear?: boolean }[]) => {
      for (const e of edits) {
        const key = cellKey(sheetId, e.row, e.col);
        const prev = overlayRef.current.get(key)
          ?? snapshotRef.current.get(key)
          ?? { sheet_id: sheetId, row: e.row, col: e.col, raw_value: '', format: '' };
        const next = e.clear
          ? { sheet_id: sheetId, row: e.row, col: e.col, raw_value: '', format: '' }
          : {
              sheet_id: sheetId, row: e.row, col: e.col,
              raw_value: e.raw_value ?? prev.raw_value,
              format: e.format ?? prev.format,
            };
        overlayRef.current.set(key, next);
      }
      deriveAndSet();
    },
    [deriveAndSet],
  );

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const [fetchedSheets, fetchedCursors, fetchedFunctions, allCells] = await Promise.all([
        client.listSheets(),
        client.getCursors(),
        client.getFunctions(),
        client.getAllCells(),
      ]);
      snapshotRef.current = snapshotFromCells(allCells);
      overlayRef.current = retireOverlay(overlayRef.current, snapshotRef.current);
      setSheets(fetchedSheets.sort((a, b) => a.position - b.position));
      setCursors(fetchedCursors);
      // Only replace the built-in functions if the backend returned a non-empty list
      if (fetchedFunctions.length > 0) setFunctions(fetchedFunctions);
      deriveAndSet();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [client, deriveAndSet]);

  // Reset the loaded flag whenever the client changes (new context) so callers
  // wait for that context's first fetch before acting on empty state.
  useEffect(() => { setLoaded(false); }, [client]);

  // Full reload when the context (client) changes.
  useEffect(() => { void refresh(); }, [refresh]);

  // Tab switch / engine init: re-derive the active sheet from the warm store.
  // No node round-trip — all sheets' inputs are already in snapshotRef.
  useEffect(() => {
    deriveAndSet();
  }, [activeSheetId, engineTick, deriveAndSet]);

  // Live updates: re-fetch on any CRDT sync event for this context
  useSubscription(contextId ? [contextId] : [], () => { void refresh(); });

  // Cursor cleanup on unmount
  useEffect(() => {
    return () => {
      if (client) { void client.removeCursor(); }
    };
  }, [client]);

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

  const setCell = useCallback(
    async (sheetId: string, row: number, col: number, rawValue: string) => {
      if (!client) return;
      applyOverlay(sheetId, [{ row, col, raw_value: rawValue }]);
      await enqueue(() =>
        rawValue.startsWith('=')
          ? // Store as formula — backend evaluates and returns computed_value
            client.setCellFormula({ sheet_id: sheetId, row, col, formula: rawValue })
          : client.setCell({ sheet_id: sheetId, row, col, raw_value: rawValue }),
      );
      // No await refresh() here — the subscription refresh reconciles + retires.
    },
    [client, applyOverlay, enqueue],
  );

  const clearCell = useCallback(async (sheetId: string, row: number, col: number) => {
    if (!client) return;
    applyOverlay(sheetId, [{ row, col, clear: true }]);
    await enqueue(() => client.clearCell({ sheet_id: sheetId, row, col }));
  }, [client, applyOverlay, enqueue]);

  const setCellFormat = useCallback(
    async (sheetId: string, row: number, col: number, format: string) => {
      if (!client) return;
      applyOverlay(sheetId, [{ row, col, format }]);
      await enqueue(() => client.setCellFormat({ sheet_id: sheetId, row, col, format }));
    },
    [client, applyOverlay, enqueue],
  );

  const applyCellOps = useCallback(
    async (sheetId: string, ops: CellOp[]) => {
      if (!client || ops.length === 0) return;
      applyOverlay(sheetId, ops.map((op) =>
        op.kind === 'Set'    ? { row: op.row, col: op.col, raw_value: op.raw_value }
        : op.kind === 'Format' ? { row: op.row, col: op.col, format: op.format }
        : { row: op.row, col: op.col, clear: true },
      ));
      await enqueue(() => client.applyCellOps({ sheet_id: sheetId, ops }));
    },
    [client, applyOverlay, enqueue],
  );

  // Fire-and-forget cursor broadcast — never block the UI waiting for it, but
  // still route it through the mutation queue so it can't clobber a concurrent
  // cell write (both are full-state commits on the node).
  const updateCursor = useCallback(
    async (sheetId: string, row: number, col: number) => {
      if (!client) return;
      void enqueue(() => client.updateCursor({ sheet_id: sheetId, row, col }));
    },
    [client, enqueue],
  );

  const exportAll = useCallback(async (): Promise<Sheet[]> => {
    if (!client) return sheets;
    return client.exportAll();
  }, [client, sheets]);

  const getSheetCells = useCallback(
    (sheetId: string) => (client ? client.getCells({ sheet_id: sheetId }) : Promise.resolve([])),
    [client],
  );

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
    cursors,
    functions,
    loading,
    loaded,
    mutating: pendingMutations > 0,
    error,
    ready: client !== null,
    initProject,
    createSheet,
    renameSheet,
    deleteSheet,
    setCell,
    clearCell,
    setCellFormat,
    applyCellOps,
    updateCursor,
    exportAll,
    getSheetCells,
    searchFunctions,
    refresh,
  };
}
