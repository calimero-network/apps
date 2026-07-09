/**
 * useSpreadsheet — live data hook for the p2p-sheets spreadsheet app.
 *
 * Wire pass: replaces the shell stubs with real SpreadsheetClient calls and
 * wires useSubscription for live CRDT sync across peers.
 *
 * Pattern:
 *  - useMemo creates the typed client when mero + contextId + executorPublicKey resolve.
 *  - refresh() fetches sheets, cells (per-sheet), cursors, and functions.
 *  - useSubscription re-fetches on every context sync event (local + remote peers).
 *  - Every mutation calls the client then refresh() for an optimistic refetch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';
import { SpreadsheetClient } from '../api/spreadsheet/SpreadsheetClient';
import type { Sheet, Cell, Cursor, FunctionDef } from '../api/spreadsheet/SpreadsheetClient';

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
  // Cursor (fire-and-forget)
  updateCursor: (sheetId: string, row: number, col: number) => Promise<void>;
  // Export
  exportAll: () => Promise<Sheet[]>;
  // Function search (local filter)
  searchFunctions: (prefix: string) => FunctionDef[];
  refresh: () => Promise<void>;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useSpreadsheet({
  contextId,
  executorPublicKey,
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

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const [fetchedSheets, fetchedCursors, fetchedFunctions] = await Promise.all([
        client.listSheets(),
        client.getCursors(),
        client.getFunctions(),
      ]);

      // Fetch cells for every sheet in parallel
      const allCells: Cell[] = [];
      if (fetchedSheets.length > 0) {
        const cellArrays = await Promise.all(
          fetchedSheets.map((sheet) => client.getCells({ sheet_id: sheet.id })),
        );
        for (const arr of cellArrays) allCells.push(...arr);
      }

      setSheets(fetchedSheets.sort((a, b) => a.position - b.position));
      setCells(allCells);
      setCursors(fetchedCursors);
      // Only replace the built-in functions if the backend returned a non-empty list
      if (fetchedFunctions.length > 0) setFunctions(fetchedFunctions);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [client]);

  // Reset the loaded flag whenever the client changes (new context) so callers
  // wait for that context's first fetch before acting on empty state.
  useEffect(() => { setLoaded(false); }, [client]);

  // Initial fetch and re-fetch when client changes (new context)
  useEffect(() => { void refresh(); }, [refresh]);

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
      await enqueue(() =>
        rawValue.startsWith('=')
          ? // Store as formula — backend evaluates and returns computed_value
            client.setCellFormula({ sheet_id: sheetId, row, col, formula: rawValue })
          : client.setCell({ sheet_id: sheetId, row, col, raw_value: rawValue }),
      );
      await refresh();
    },
    [client, refresh, enqueue],
  );

  const clearCell = useCallback(async (sheetId: string, row: number, col: number) => {
    if (!client) return;
    await enqueue(() => client.clearCell({ sheet_id: sheetId, row, col }));
    await refresh();
  }, [client, refresh, enqueue]);

  const setCellFormat = useCallback(
    async (sheetId: string, row: number, col: number, format: string) => {
      if (!client) return;
      await enqueue(() => client.setCellFormat({ sheet_id: sheetId, row, col, format }));
      await refresh();
    },
    [client, refresh, enqueue],
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
    updateCursor,
    exportAll,
    searchFunctions,
    refresh,
  };
}
