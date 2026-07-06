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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [error, setError] = useState<Error | null>(null);

  // Memoized typed client — null until mero + context + identity all resolve.
  const client = useMemo(
    () =>
      mero && contextId && executorPublicKey
        ? new SpreadsheetClient(mero, contextId, executorPublicKey)
        : null,
    [mero, contextId, executorPublicKey],
  );

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
    }
  }, [client]);

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
    await client.initProject({ name });
    await refresh();
  }, [client, refresh]);

  const createSheet = useCallback(async (name: string) => {
    if (!client) return;
    await client.createSheet({ name });
    await refresh();
  }, [client, refresh]);

  const renameSheet = useCallback(async (sheetId: string, newName: string) => {
    if (!client) return;
    await client.renameSheet({ sheet_id: sheetId, new_name: newName });
    await refresh();
  }, [client, refresh]);

  const deleteSheet = useCallback(async (sheetId: string) => {
    if (!client) return;
    await client.deleteSheet({ sheet_id: sheetId });
    await refresh();
  }, [client, refresh]);

  const setCell = useCallback(
    async (sheetId: string, row: number, col: number, rawValue: string) => {
      if (!client) return;
      if (rawValue.startsWith('=')) {
        // Store as formula — backend evaluates and returns computed_value
        await client.setCellFormula({ sheet_id: sheetId, row, col, formula: rawValue });
      } else {
        await client.setCell({ sheet_id: sheetId, row, col, raw_value: rawValue });
      }
      await refresh();
    },
    [client, refresh],
  );

  const clearCell = useCallback(async (sheetId: string, row: number, col: number) => {
    if (!client) return;
    await client.clearCell({ sheet_id: sheetId, row, col });
    await refresh();
  }, [client, refresh]);

  // Fire-and-forget cursor broadcast — never block the UI waiting for it
  const updateCursor = useCallback(
    async (sheetId: string, row: number, col: number) => {
      if (!client) return;
      void client.updateCursor({ sheet_id: sheetId, row, col });
    },
    [client],
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
    error,
    ready: client !== null,
    initProject,
    createSheet,
    renameSheet,
    deleteSheet,
    setCell,
    clearCell,
    updateCursor,
    exportAll,
    searchFunctions,
    refresh,
  };
}
