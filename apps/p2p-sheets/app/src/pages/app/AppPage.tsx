/**
 * AppPage — the full spreadsheet workspace.
 *
 * Layout (full viewport):
 *   ┌──────────────────────── TitleBar ───────────────────────────┐
 *   ├──────────────────────── CollabBar ──────────────────────────┤
 *   ├─────────────────────── FormulaBar ──────────────────────────┤
 *   │                                                             │
 *   │                    SpreadsheetGrid                          │
 *   │                                                             │
 *   ├──────────────────────── SheetTabs ──────────────────────────┤
 *   └──────────────────────── StatusBar ──────────────────────────┘
 *
 * FunctionHelpPanel slides in from the right as an overlay.
 *
 * Three states:
 *  1. Workspace picker (!ws.contextId) — open / create / join a workspace
 *  2. Opening (ws.contextId set, !ws.ready) — identity resolving
 *  3. Workspace open — full spreadsheet UI (with ← back to the picker)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { C, useTheme, MoonIcon } from '../../theme';
import { APP_DISPLAY_NAME } from '../../config';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useSpreadsheet } from '../../hooks/useSpreadsheet';
import { describeError } from '../../utils/errors';
import { cellRef } from '../../components/FormulaBar';
import { isFormula, insertReference, type AutoRef } from '../../spreadsheet/formulaEdit';
import { normalizeRect, sheetPrefix, rectCells, type CellCoord, type Rect } from '../../spreadsheet/refs';
import { planFill } from '../../spreadsheet/fill';
import { toTSV, fromTSV } from '../../spreadsheet/clipboard';
import { planPaste, type ClipPayload, type ClipCell, type PasteWrite } from '../../spreadsheet/paste';
import FormulaBar from '../../components/FormulaBar';
import SpreadsheetGrid from '../../components/SpreadsheetGrid';
import SheetTabs from '../../components/SheetTabs';
import FunctionHelpPanel from '../../components/FunctionHelpPanel';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';
import ContextMenu from '../../components/ContextMenu';
import { formatValue } from '../../spreadsheet/format';
import StatusBar from '../../components/StatusBar';
import { distinctCollaborators, peerCount } from '../../spreadsheet/presence';

const COLS = 26;
const ROWS = 50;

export default function AppPage() {
  const { logout } = useMero();
  const ws = useWorkspace();
  const ss = useSpreadsheet({
    contextId: ws.contextId,
    executorPublicKey: ws.executorPublicKey,
  });
  const { theme, toggle: toggleTheme } = useTheme();

  // ── Workspace modals ────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  // ── New-workspace bootstrap ─────────────────────────────────────
  const [projectName, setProjectName] = useState('Untitled Spreadsheet');

  // A freshly-created workspace must be initialised with its project name once
  // its context is ready (the client is available by then). `ws.pendingInitName`
  // is set by createWorkspace and cleared here after init runs, so it fires once
  // per newly-created workspace and never when opening an existing one.
  const initProjectRef = useRef(ss.initProject);
  useEffect(() => { initProjectRef.current = ss.initProject; });
  const initedRef = useRef<string | null>(null);
  useEffect(() => {
    if (ws.ready && ws.contextId && ws.pendingInitName && initedRef.current !== ws.contextId) {
      initedRef.current = ws.contextId;
      const name = ws.pendingInitName;
      ws.clearPendingInit();
      void initProjectRef.current(name);
    }
  }, [ws.ready, ws.contextId, ws.pendingInitName, ws]);

  // ── Spreadsheet state ───────────────────────────────────────────
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<CellCoord | null>(null);
  const [selectionRange, setSelectionRange] = useState<Rect | null>(null);
  const [clipboard, setClipboard] = useState<ClipPayload | null>(null);
  const [formulaInput, setFormulaInput] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  // Edit mode: true while actively editing the selected cell (entered by typing,
  // F2, double-click, or clicking into the formula bar). Distinct from mere
  // selection — that's what lets a plain click navigate but a click while
  // editing a formula insert a reference.
  const [editing, setEditing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  // Marks the reference the last point-click inserted, so the next click can
  // replace it (Sheets behaviour: click A1 then B2 → `=B2`, not `=A1B2`).
  const autoRefRef = useRef<AutoRef | undefined>(undefined);
  // The cell whose formula is being edited (its "home"). Stays fixed while you
  // browse other sheet tabs to point-pick cells, so cross-sheet refs insert and
  // the commit lands back on the home cell. Null when not editing.
  const [editAnchor, setEditAnchor] = useState<{ sheetId: string; row: number; col: number } | null>(null);

  // Point mode: active while editing a formula. In this mode clicking/dragging
  // cells (or headers) inserts their reference into the formula instead of
  // moving the selection — standard spreadsheet flow.
  const pointMode = editing && isFormula(formulaInput);
  // While point-picking on a sheet other than the formula's home sheet, refs
  // are qualified with that sheet's name (`Data!A1`).
  const pickingForeignSheet = pointMode && editAnchor != null && editAnchor.sheetId !== activeSheetId;

  // Auto-select the first sheet when sheets load / change
  useEffect(() => {
    if (ss.sheets.length > 0) {
      const stillExists = ss.sheets.find((s) => s.id === activeSheetId);
      if (!stillExists) setActiveSheetId(ss.sheets[0].id);
    }
  }, [ss.sheets, activeSheetId]);

  // Safety net: guarantee an editable sheet exists. The formula bar is disabled
  // without an active sheet, so a workspace with zero sheets opens read-only —
  // you can't type in any cell. `initProject` creates a default sheet for the
  // creator, but a context can become ready without that path (e.g. an
  // auto-created / externally-provisioned context), leaving it sheetless. When
  // the workspace is ready, finished its initial load, and is genuinely empty
  // (no sheets AND no cells — so we don't race a joiner mid-sync into creating
  // a duplicate), create one default sheet, once per opened workspace.
  const ensuredDefaultSheetRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      ss.ready &&
      ss.loaded && // the first fetch has resolved — empty is authoritative, not "not-yet-loaded"
      ss.sheets.length === 0 &&
      ss.cells.length === 0 &&
      ws.contextId &&
      ensuredDefaultSheetRef.current !== ws.contextId
    ) {
      ensuredDefaultSheetRef.current = ws.contextId;
      void ss.createSheet('Sheet 1');
    }
  }, [ss.ready, ss.loaded, ss.sheets.length, ss.cells.length, ss, ws.contextId]);

  // Reset per-workspace view state when switching workspaces.
  useEffect(() => {
    setActiveSheetId(null);
    setSelectedCell(null);
    setSelectionRange(null);
    setFormulaInput('');
    setIsDirty(false);
    setEditing(false);
    setEditAnchor(null);
  }, [ws.contextId]);

  // Sync formula bar when selected cell or cells data changes
  const prevCellRef = useRef<string | null>(null);
  useEffect(() => {
    const key = selectedCell ? `${activeSheetId}:${selectedCell.row}-${selectedCell.col}` : null;
    if (key === prevCellRef.current) return;
    prevCellRef.current = key;

    // Mid-edit the formula text is authoritative — don't let a sheet/cell key
    // change (e.g. switching tabs to point-pick a cross-sheet ref) overwrite it.
    if (editing) return;

    if (!selectedCell || !activeSheetId) {
      setFormulaInput('');
      setIsDirty(false);
      return;
    }
    const cell = ss.cells.find(
      (c) =>
        c.sheet_id === activeSheetId &&
        c.row === selectedCell.row &&
        c.col === selectedCell.col,
    );
    setFormulaInput(cell?.raw_value ?? '');
    setIsDirty(false);
  }, [selectedCell, activeSheetId]); // intentionally omit ss.cells so typing doesn't reset

  // ── Commit current cell ─────────────────────────────────────────
  const commitCellRef = useRef<(() => Promise<void>) | null>(null);
  const commitCell = useCallback(async () => {
    // The formula belongs to its home cell (editAnchor) even if you're viewing
    // another sheet to point-pick; otherwise it's the plain selected cell.
    const target =
      editAnchor ??
      (selectedCell && activeSheetId
        ? { sheetId: activeSheetId, row: selectedCell.row, col: selectedCell.col }
        : null);
    if (!target || !isDirty) return;
    const value = formulaInput;
    if (!value.trim()) {
      await ss.clearCell(target.sheetId, target.row, target.col);
    } else {
      await ss.setCell(target.sheetId, target.row, target.col, value);
    }
    setIsDirty(false);
    setEditing(false);
    setEditAnchor(null);
    autoRefRef.current = undefined;
  }, [editAnchor, selectedCell, activeSheetId, isDirty, formulaInput, ss]);

  // Keep ref current so SpreadsheetGrid can call it
  commitCellRef.current = commitCell;

  // Focus the formula bar after a selection so you can type immediately
  // (autofocus-on-select) without entering edit mode.
  const focusFormulaBar = useCallback(() => {
    requestAnimationFrame(() => {
      const el = formulaInputRef.current;
      if (el && !el.disabled) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  }, []);

  // Pin the formula's home cell the first time an edit begins, so browsing to
  // another sheet to point-pick keeps the formula anchored there. No-op once set.
  const ensureEditAnchor = useCallback(() => {
    if (activeSheetId && selectedCell) {
      setEditAnchor((prev) =>
        prev ?? { sheetId: activeSheetId, row: selectedCell.row, col: selectedCell.col },
      );
    }
  }, [activeSheetId, selectedCell]);

  // ── Cell selection ──────────────────────────────────────────────
  const handleSelectCell = useCallback(
    async (row: number, col: number) => {
      // Commit dirty cell before moving
      if (isDirty && selectedCell && activeSheetId) {
        await commitCellRef.current?.();
      }
      setSelectedCell({ row, col });
      setSelectionRange(null);
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
      focusFormulaBar();
      if (activeSheetId) {
        void ss.updateCursor(activeSheetId, row, col);
      }
    },
    [isDirty, selectedCell, activeSheetId, ss, focusFormulaBar],
  );

  // Drag-select a rectangular range; the focus (active) cell is the drag end.
  const handleSelectRange = useCallback(
    (a: CellCoord, b: CellCoord) => {
      setSelectedCell(b);
      setSelectionRange(normalizeRect(a, b));
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
    },
    [],
  );

  // Whole-column / whole-row selection from a header click.
  const handleSelectColumn = useCallback(
    async (col: number) => {
      if (isDirty && selectedCell && activeSheetId) await commitCellRef.current?.();
      setSelectedCell({ row: 0, col });
      setSelectionRange({ top: 0, left: col, bottom: ROWS - 1, right: col });
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
      focusFormulaBar();
    },
    [isDirty, selectedCell, activeSheetId, focusFormulaBar],
  );
  const handleSelectRow = useCallback(
    async (row: number) => {
      if (isDirty && selectedCell && activeSheetId) await commitCellRef.current?.();
      setSelectedCell({ row, col: 0 });
      setSelectionRange({ top: row, left: 0, bottom: row, right: COLS - 1 });
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
      focusFormulaBar();
    },
    [isDirty, selectedCell, activeSheetId, focusFormulaBar],
  );

  // Double-click / F2: enter edit mode on a cell and focus the formula bar.
  const handleEditCell = useCallback(
    (row: number, col: number) => {
      const already = selectedCell?.row === row && selectedCell?.col === col;
      if (!already) setSelectedCell({ row, col });
      setSelectionRange(null);
      setEditing(true);
      if (activeSheetId) setEditAnchor({ sheetId: activeSheetId, row, col });
      autoRefRef.current = undefined;
      requestAnimationFrame(() => formulaInputRef.current?.focus());
    },
    [selectedCell, activeSheetId],
  );

  // Commit + move (Enter = down, Tab = right)
  const handleCommitAndMove = useCallback(
    async (direction: 'down' | 'right' | 'none') => {
      await commitCellRef.current?.();
      if (!selectedCell) return;
      const { row, col } = selectedCell;
      if (direction === 'down' && row < ROWS - 1) setSelectedCell({ row: row + 1, col });
      else if (direction === 'right' && col < COLS - 1) setSelectedCell({ row, col: col + 1 });
    },
    [selectedCell],
  );

  // ── Formula bar ─────────────────────────────────────────────────
  const handleFormulaChange = useCallback((v: string) => {
    setFormulaInput(v);
    setIsDirty(true);
    setEditing(true);
    ensureEditAnchor();
    // Typing breaks the point-mode replace chain — the next clicked ref should
    // insert at the caret, not replace the previously-inserted one.
    autoRefRef.current = undefined;
  }, [ensureEditAnchor]);

  // Clicking into the formula bar begins editing (so a subsequent cell click
  // inserts a reference rather than navigating).
  const handleBeginEdit = useCallback(() => {
    setEditing(true);
    ensureEditAnchor();
  }, [ensureEditAnchor]);

  const handleFormulaCommit = useCallback(async () => {
    const home = editAnchor;
    await commitCellRef.current?.();
    // If we wandered onto another sheet to point-pick, snap back to the home
    // sheet so the committed cell and the post-commit "move down" are visible.
    if (home && home.sheetId !== activeSheetId) setActiveSheetId(home.sheetId);
    // Move down after commit via formula bar Enter
    setSelectedCell((prev) =>
      prev && prev.row < ROWS - 1 ? { row: prev.row + 1, col: prev.col } : prev,
    );
    setSelectionRange(null);
  }, [editAnchor, activeSheetId]);

  const handleFormulaCancel = useCallback(() => {
    const home = editAnchor;
    setEditing(false);
    setEditAnchor(null);
    autoRefRef.current = undefined;
    if (home && home.sheetId !== activeSheetId) setActiveSheetId(home.sheetId);
    // Revert to stored value at the home cell
    const sheetId = home?.sheetId ?? activeSheetId;
    if (!selectedCell || !sheetId) return;
    const cell = ss.cells.find(
      (c) =>
        c.sheet_id === sheetId &&
        c.row === selectedCell.row &&
        c.col === selectedCell.col,
    );
    setFormulaInput(cell?.raw_value ?? '');
    setIsDirty(false);
  }, [editAnchor, selectedCell, activeSheetId, ss.cells]);

  // Insert a cell/range reference into the formula at the caret (point mode).
  const insertRef = useCallback(
    (ref: string) => {
      const el = formulaInputRef.current;
      const cur = formulaInput;
      const selStart = el?.selectionStart ?? cur.length;
      const selEnd = el?.selectionEnd ?? selStart;
      // When point-picking on a sheet other than the formula's home, qualify the
      // reference with that sheet's name (`Data!A1`, `'Q3 Budget'!B2:C4`).
      const qualified = pickingForeignSheet
        ? `${sheetPrefix(ss.sheets.find((s) => s.id === activeSheetId)?.name ?? '')}${ref}`
        : ref;
      const res = insertReference(
        { text: cur, selStart, selEnd, autoRef: autoRefRef.current },
        qualified,
      );
      autoRefRef.current = res.autoRef;
      setFormulaInput(res.text);
      setIsDirty(true);
      setEditing(true);
      // Restore focus and place the caret just after the inserted reference so
      // the user can keep typing (e.g. an operator, or `)`).
      requestAnimationFrame(() => {
        const e2 = formulaInputRef.current;
        if (e2) {
          e2.focus();
          e2.setSelectionRange(res.caret, res.caret);
        }
      });
    },
    [formulaInput, pickingForeignSheet, ss.sheets, activeSheetId],
  );

  // ── Sheet management ────────────────────────────────────────────
  const handleAddSheet = useCallback(async () => {
    const name = `Sheet ${ss.sheets.length + 1}`;
    await ss.createSheet(name);
  }, [ss]);

  const handleSelectSheet = useCallback(
    async (id: string) => {
      // While editing a formula, switching tabs is a point-pick move: keep the
      // edit (formula text, home anchor, formula-bar focus) and just view the
      // other sheet so its cells can be clicked in as `Sheet!A1` references.
      if (pointMode) {
        ensureEditAnchor();
        setActiveSheetId(id);
        setSelectionRange(null);
        requestAnimationFrame(() => formulaInputRef.current?.focus());
        return;
      }
      if (isDirty) await commitCellRef.current?.();
      setActiveSheetId(id);
      setSelectedCell(null);
      setSelectionRange(null);
      setFormulaInput('');
      setIsDirty(false);
      setEditing(false);
      setEditAnchor(null);
      autoRefRef.current = undefined;
    },
    [isDirty, pointMode, ensureEditAnchor],
  );

  // Right-click a cell: if it's outside the current selection, select just it;
  // then open the Format menu at the cursor.
  const handleCellContextMenu = useCallback(
    (row: number, col: number, x: number, y: number) => {
      const inSel =
        selectionRange &&
        row >= selectionRange.top && row <= selectionRange.bottom &&
        col >= selectionRange.left && col <= selectionRange.right;
      if (!inSel) {
        setSelectedCell({ row, col });
        setSelectionRange(null);
        setEditing(false);
      }
      setCtxMenu({ x, y });
    },
    [selectionRange],
  );

  // Apply a format keyword to every cell in the current selection (or the
  // single selected cell), then close the menu.
  const applyFormat = useCallback(
    async (format: string) => {
      setCtxMenu(null);
      if (!activeSheetId) return;
      const rect =
        selectionRange ??
        (selectedCell
          ? { top: selectedCell.row, left: selectedCell.col, bottom: selectedCell.row, right: selectedCell.col }
          : null);
      if (!rect) return;
      for (let r = rect.top; r <= rect.bottom; r++) {
        for (let c = rect.left; c <= rect.right; c++) {
          await ss.setCellFormat(activeSheetId, r, c, format);
        }
      }
    },
    [activeSheetId, selectionRange, selectedCell, ss],
  );

  // Apply a fill drag: compute the writes from the source→target rects and
  // persist them. Empty results clear the cell; formats follow the pattern.
  const handleFill = useCallback(
    async (source: Rect, target: Rect) => {
      if (!activeSheetId) return;
      const getCell = (r: number, c: number) => {
        const cell = ss.cells.find(
          (x) => x.sheet_id === activeSheetId && x.row === r && x.col === c,
        );
        return cell ? { raw: cell.raw_value, format: cell.format } : null;
      };
      const writes = planFill(source, target, getCell);
      for (const w of writes) {
        if (w.raw.trim() === '') {
          // Empty target: clear the cell (drops any value AND format).
          await ss.clearCell(activeSheetId, w.row, w.col);
        } else {
          await ss.setCell(activeSheetId, w.row, w.col, w.raw);
          // Always apply the pattern's format — including '' — so filling an
          // unformatted pattern over a previously-formatted cell clears the
          // stale format instead of leaving it behind.
          await ss.setCellFormat(activeSheetId, w.row, w.col, w.format);
        }
      }
    },
    [activeSheetId, ss],
  );

  // The rect the clipboard/delete operate on: the multi-cell selection, or the
  // single selected cell.
  const currentRegion = useCallback((): Rect | null => {
    if (selectionRange) return selectionRange;
    if (selectedCell) {
      return { top: selectedCell.row, left: selectedCell.col, bottom: selectedCell.row, right: selectedCell.col };
    }
    return null;
  }, [selectionRange, selectedCell]);

  // Build the internal payload + TSV for a copy or cut of the current region.
  // The event originates on the grid's hidden focus-catcher textarea (see
  // SpreadsheetGrid): Chrome only fires copy/cut/paste when an editable element
  // is focused (or text is selected), so a non-editable grid div never receives
  // them — the catcher is the element that makes these events fire at all.
  const buildClip = useCallback(
    (cut: boolean, e: React.ClipboardEvent) => {
      if (editing || !activeSheetId || !e.clipboardData) return;
      const region = currentRegion();
      if (!region) return;
      e.preventDefault();
      const at = (r: number, c: number) =>
        ss.cells.find((x) => x.sheet_id === activeSheetId && x.row === r && x.col === c);
      // TSV of computed values (for external apps), row-major over the rect.
      const values: string[][] = [];
      for (let r = region.top; r <= region.bottom; r++) {
        const rowVals: string[] = [];
        for (let c = region.left; c <= region.right; c++) rowVals.push(at(r, c)?.computed_value ?? '');
        values.push(rowVals);
      }
      const tsv = toTSV(values);
      // Internal cells (raw + format), offsets from the region top-left. Empty
      // source cells are included so a paste clears the matching target cell.
      const cells: ClipCell[] = rectCells(region).map(({ row, col }) => {
        const cell = at(row, col);
        return {
          dr: row - region.top,
          dc: col - region.left,
          raw: cell?.raw_value ?? '',
          format: cell?.format ?? '',
        };
      });
      e.clipboardData.setData('text/plain', tsv);
      setClipboard({
        cells,
        rows: region.bottom - region.top + 1,
        cols: region.right - region.left + 1,
        cut,
        sourceRect: region,
        tsv,
      });
    },
    [editing, activeSheetId, currentRegion, ss.cells],
  );

  const handleCopy = useCallback((e: React.ClipboardEvent) => buildClip(false, e), [buildClip]);
  const handleCut = useCallback((e: React.ClipboardEvent) => buildClip(true, e), [buildClip]);

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (editing || !activeSheetId || !e.clipboardData) return;
      const region = currentRegion();
      if (!region) return;
      e.preventDefault();
      const anchor = { row: region.top, col: region.left };
      // Normalize CRLF — Windows clipboards round-trip text/plain as \r\n, so
      // without this an internal multi-row copy would fail self-detection and
      // fall through to the values-only external path.
      const text = e.clipboardData.getData('text/plain').replace(/\r\n/g, '\n');
      const internal = !!clipboard && text === clipboard.tsv;

      // For a cut, clear the source FIRST: the writes come from the in-memory
      // payload (not re-read from live cells), so clearing first means an
      // overlapping paste target isn't wiped by a later source-clear.
      if (internal && clipboard!.cut) {
        for (const { row, col } of rectCells(clipboard!.sourceRect)) {
          await ss.clearCell(activeSheetId, row, col);
        }
      }

      const writes: PasteWrite[] = internal
        ? planPaste(clipboard!, anchor)
        : // External TSV → raw values, anchored at the selection top-left.
          fromTSV(text).flatMap((rowVals, r) =>
            rowVals.map((v, c) => ({ row: anchor.row + r, col: anchor.col + c, raw: v, format: '' })),
          );

      for (const w of writes) {
        if (w.row < 0 || w.row >= ROWS || w.col < 0 || w.col >= COLS) continue; // clip
        if (w.raw.trim() === '') {
          await ss.clearCell(activeSheetId, w.row, w.col);
        } else {
          await ss.setCell(activeSheetId, w.row, w.col, w.raw);
          // Only apply a non-empty format. A plain copy carries "", and applying
          // an empty format is a pointless second mutation on the cell.
          if (w.format) {
            await ss.setCellFormat(activeSheetId, w.row, w.col, w.format);
          }
        }
      }

      if (internal && clipboard!.cut) setClipboard(null); // consumed cut empties the clipboard
    },
    [editing, activeSheetId, currentRegion, clipboard, ss],
  );

  const handleDelete = useCallback(async () => {
    if (editing || !activeSheetId) return;
    const region = currentRegion();
    if (!region) return;
    for (const { row, col } of rectCells(region)) {
      await ss.clearCell(activeSheetId, row, col);
    }
  }, [editing, activeSheetId, currentRegion, ss]);

  const handleClearClipboard = useCallback(() => setClipboard(null), []);

  // Format of the anchor cell, to check-mark the active option in the menu.
  const activeCellFormat =
    (selectedCell && activeSheetId
      ? ss.cells.find(
          (c) => c.sheet_id === activeSheetId && c.row === selectedCell.row && c.col === selectedCell.col,
        )?.format
      : '') ?? '';

  // ── Download ────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    const lines: string[] = [];
    for (const sheet of ss.sheets) {
      lines.push(`# ${sheet.name}`);
      const sheetCells = ss.cells.filter((c) => c.sheet_id === sheet.id);
      if (sheetCells.length > 0) {
        const maxRow = sheetCells.reduce((m, c) => Math.max(m, c.row), 0);
        const maxCol = sheetCells.reduce((m, c) => Math.max(m, c.col), 0);
        for (let r = 0; r <= maxRow; r++) {
          const rowData: string[] = [];
          for (let c = 0; c <= maxCol; c++) {
            const cell = sheetCells.find((x) => x.row === r && x.col === c);
            const val = cell
              ? formatValue(cell.computed_value, cell.format).replace(/"/g, '""')
              : '';
            rowData.push(`"${val}"`);
          }
          lines.push(rowData.join(','));
        }
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_DISPLAY_NAME.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ss.sheets, ss.cells]);

  // ════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════

  // 1. Workspace picker — shown whenever no workspace is open. Lists every
  //    workspace on this node and lets you open, create, or join one.
  if (!ws.contextId) {
    const listLoading = ws.loading && ws.workspaces.length === 0;
    return (
      <FullCenter>
        <WelcomeCard>
          <WelcomeIcon aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </WelcomeIcon>
          <h2>{APP_DISPLAY_NAME}</h2>
          <p>
            Open a workspace, create a new one, or join one you&rsquo;ve been
            invited to. All data lives on your node — no central server.
          </p>

          {ws.workspaces.length > 0 && (
            <WorkspaceList aria-label="Your workspaces">
              {ws.workspaces.map((w) => (
                <WorkspaceRow
                  key={w.contextId}
                  data-testid="workspace-item"
                  onClick={() => ws.openWorkspace(w.contextId)}
                  title={`Open ${w.name}`}
                >
                  <WorkspaceMeta>
                    <WorkspaceName>{w.name}</WorkspaceName>
                    <WorkspaceId>{w.contextId.slice(0, 10)}…</WorkspaceId>
                  </WorkspaceMeta>
                  <OpenChevron aria-hidden="true">→</OpenChevron>
                </WorkspaceRow>
              ))}
            </WorkspaceList>
          )}

          {listLoading && <p style={{ margin: '4px 0 16px' }}>Loading workspaces…</p>}

          <label htmlFor="project-name" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontSize: 13, fontWeight: 600, color: C.muted }}>
            New workspace name
          </label>
          <ProjectNameInput
            id="project-name"
            data-testid="field-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Q3 Budget, Team OKRs…"
          />

          <ButtonRow>
            <PrimaryBtn
              data-testid="action-init_project"
              disabled={!projectName.trim() || ws.loading}
              onClick={() => void ws.createWorkspace(projectName.trim())}
            >
              Create workspace
            </PrimaryBtn>
            <SecondaryBtn onClick={() => setShowJoin(true)}>
              Join with invitation
            </SecondaryBtn>
          </ButtonRow>

          {ws.error && <ErrLine>{describeError(ws.error)}</ErrLine>}
        </WelcomeCard>

        {showJoin && (
          <JoinModal
            onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
            onClose={() => setShowJoin(false)}
          />
        )}
      </FullCenter>
    );
  }

  // 2. A workspace is opening — its context identity is still resolving.
  if (!ws.ready) {
    return (
      <FullCenter>
        <WelcomeCard>
          <h2>Opening workspace…</h2>
          <p>Resolving your identity in this context.</p>
          <SecondaryBtn onClick={ws.leaveWorkspace}>← Back to workspaces</SecondaryBtn>
        </WelcomeCard>
      </FullCenter>
    );
  }

  // 3. Full spreadsheet view
  const selRef = selectedCell ? cellRef(selectedCell.row, selectedCell.col) : null;
  const activeWorkspaceName =
    ws.workspaces.find((w) => w.contextId === ws.contextId)?.name ?? APP_DISPLAY_NAME;
  const collaborators = distinctCollaborators(ss.cursors, ws.executorPublicKey, C.green);
  const peers = peerCount(ss.cursors, ws.executorPublicKey);
  const connected = ss.ready && ss.loaded;
  const synced = ss.loaded && !ss.mutating;

  return (
    <AppShell>
      {/* ── Window chrome: title bar + collaborator bar ─────────────── */}
      <TitleBar>
        <Lights aria-hidden="true"><i /><i /><i /></Lights>
        <BackBtn
          onClick={async () => { if (isDirty) await commitCellRef.current?.(); ws.leaveWorkspace(); }}
          title="Back to workspaces"
          aria-label="Back to workspaces"
        >
          ←
        </BackBtn>
        <GridIcon aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </GridIcon>
        <TitleName>{activeWorkspaceName}</TitleName>
        <NodeTag>· your node</NodeTag>
        <LivePill $on={connected} title={connected ? 'Live' : 'Offline'}>
          <span aria-hidden="true">●</span>{connected ? 'live' : 'offline'}
        </LivePill>
      </TitleBar>

      <CollabBar>
        <Avatars aria-label={`${collaborators.length} collaborators`}>
          {collaborators.map((c) => (
            <Avatar
              key={c.author}
              style={{ background: c.color }}
              $self={c.isSelf}
              title={c.isSelf ? 'You' : c.author}
            >
              {c.label}
            </Avatar>
          ))}
        </Avatars>
        <CollabCount>
          {collaborators.length} collaborator{collaborators.length === 1 ? '' : 's'}
        </CollabCount>

        <ActionsSpacer />

        <PrimaryAction onClick={() => setShowInvite(true)} aria-label="Invite collaborators">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          <span>Invite</span>
        </PrimaryAction>

        <ToolBtn onClick={() => setShowJoin(true)} aria-label="Join workspace">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          <span>Join</span>
        </ToolBtn>

        <ToolBtn
          data-testid="action-export_all"
          onClick={handleDownload}
          title="Download as CSV"
          aria-label="Download spreadsheet as CSV"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Download</span>
        </ToolBtn>

        <ToolBtn onClick={() => setShowHelp(true)} title="Function reference" aria-label="Open function reference">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Functions</span>
        </ToolBtn>

        <IconBtn onClick={toggleTheme} title="Toggle theme" aria-label="Toggle light/dark theme">
          <MoonIcon filled={theme === 'dark'} size={16} />
        </IconBtn>

        <SignOutBtn onClick={logout} aria-label="Sign out">Sign out</SignOutBtn>
      </CollabBar>

      {/* ── Formula bar ──────────────────────────────────────────── */}
      <FormulaBar
        selectedCell={selectedCell}
        value={formulaInput}
        onChange={handleFormulaChange}
        onCommit={handleFormulaCommit}
        onCancel={handleFormulaCancel}
        onBeginEdit={handleBeginEdit}
        functions={ss.functions}
        disabled={!activeSheetId}
        inputRef={formulaInputRef}
        editing={editing}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onGridDelete={handleDelete}
        onGridClearClipboard={handleClearClipboard}
      />

      {/* Commit button next to formula bar (accessible test target) */}
      {isDirty && selectedCell && (
        <CommitBar>
          <CommitBtn
            data-testid="action-set_cell"
            onClick={handleFormulaCommit}
            aria-label={`Commit value to cell ${selRef ?? ''}`}
            title="Confirm (Enter)"
          >
            ✓
          </CommitBtn>
          <CancelCommitBtn
            data-testid="action-clear_cell"
            onClick={handleFormulaCancel}
            aria-label="Cancel edit"
            title="Cancel (Escape)"
          >
            ✗
          </CancelCommitBtn>
        </CommitBar>
      )}

      {/* ── Spreadsheet grid ─────────────────────────────────────── */}
      <SpreadsheetGrid
        sheetId={activeSheetId}
        cells={ss.cells}
        cursors={ss.cursors}
        selectedCell={pickingForeignSheet ? null : selectedCell}
        selectionRange={pickingForeignSheet ? null : selectionRange}
        editingValue={pickingForeignSheet ? null : isDirty ? formulaInput : null}
        pointMode={pointMode}
        onPointRef={insertRef}
        onSelectCell={handleSelectCell}
        onSelectRange={handleSelectRange}
        onSelectColumn={handleSelectColumn}
        onSelectRow={handleSelectRow}
        onEditCell={handleEditCell}
        onCommitAndMove={handleCommitAndMove}
        onCellContextMenu={handleCellContextMenu}
        onFill={handleFill}
        onDelete={handleDelete}
        onClearClipboard={handleClearClipboard}
        copiedRegion={clipboard ? { rect: clipboard.sourceRect, cut: clipboard.cut } : null}
      />

      {/* ── Sheet tabs ───────────────────────────────────────────── */}
      <SheetTabs
        sheets={ss.sheets}
        activeSheetId={activeSheetId}
        onSelect={handleSelectSheet}
        onAdd={handleAddSheet}
        onRename={ss.renameSheet}
        onDelete={ss.deleteSheet}
      />

      <StatusBar synced={synced} peers={peers} cells={ss.cells.length} />

      {/* ── Overlays ─────────────────────────────────────────────── */}
      {showHelp && (
        <FunctionHelpPanel
          functions={ss.functions}
          onClose={() => setShowHelp(false)}
        />
      )}
      {showInvite && (
        <InviteModal
          onInvite={ws.invite}
          onClose={() => setShowInvite(false)}
        />
      )}
      {showJoin && (
        <JoinModal
          onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
          onClose={() => setShowJoin(false)}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          activeFormat={activeCellFormat}
          onSelect={(fmt) => void applyFormat(fmt)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </AppShell>
  );
}

// ── Styled components ────────────────────────────────────────────────────────

const AppShell = styled.div`
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: ${C.paper};
  color: ${C.ink};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
`;

const TitleBar = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  flex-shrink: 0;
  padding: 0 12px;
  background: ${C.chrome};
  border-bottom: 1px solid ${C.line};
`;

const Lights = styled.div`
  display: flex;
  gap: 6px;
  margin-right: 4px;
  i {
    width: 10px; height: 10px; border-radius: 50%;
    display: block;
  }
  i:nth-child(1) { background: #ff5f56; }
  i:nth-child(2) { background: #ffbd2e; }
  i:nth-child(3) { background: ${C.green}; }
`;

const TitleName = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${C.ink};
  letter-spacing: -0.2px;
  white-space: nowrap;
`;

const NodeTag = styled.span`
  font-size: 12px;
  color: ${C.muted};
  white-space: nowrap;
`;

const LivePill = styled.span<{ $on: boolean }>`
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: ${(p) => (p.$on ? C.green : C.muted)};
  span { font-size: 8px; }
`;

const CollabBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  flex-shrink: 0;
  padding: 0 12px;
  background: ${C.paper};
  border-bottom: 1px solid ${C.line};
`;

const Avatars = styled.div`
  display: flex;
  align-items: center;
  padding-left: 6px;
`;

const Avatar = styled.span<{ $self: boolean }>`
  width: 24px; height: 24px;
  margin-left: -6px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  color: ${C.onAccent};
  border: 2px solid ${C.paper};
  box-shadow: ${(p) => (p.$self ? `0 0 0 2px ${C.green}` : 'none')};
`;

const CollabCount = styled.span`
  font-size: 12px;
  color: ${C.muted};
  white-space: nowrap;
  @media (max-width: 700px) { display: none; }
`;

const ActionsSpacer = styled.div`
  margin-left: auto;
`;

const PrimaryAction = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: ${C.onAccent};
  background: ${C.green};
  border: 1px solid ${C.greenHover};
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s, transform 0.12s;
  svg { flex-shrink: 0; }
  &:hover { background: ${C.greenHover}; transform: translateY(-1px); }
  @media (max-width: 700px) { span { display: none; } }
`;

const IconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px; height: 32px;
  color: ${C.muted};
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;

const BackBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  font-size: 17px;
  line-height: 1;
  color: ${C.muted};
  background: transparent;
  border: 1px solid ${C.line};
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
  &:hover { background: ${C.paper2}; color: ${C.ink}; }
`;

const GridIcon = styled.div`
  display: flex;
  align-items: center;
  color: ${C.green};
`;

const ToolBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 12.5px;
  font-weight: 500;
  color: ${C.muted};
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s, color 0.14s;

  svg { flex-shrink: 0; }

  &:hover {
    background: ${C.paper2};
    color: ${C.ink};
  }

  @media (max-width: 700px) { span { display: none; } }
`;

const SignOutBtn = styled.button`
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 500;
  color: ${C.muted};
  background: transparent;
  border: 1px solid ${C.line};
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s, color 0.14s;
  margin-left: 4px;

  &:hover {
    background: ${C.paper2};
    color: ${C.ink};
  }
`;

/* Inline commit/cancel buttons shown in formula bar area when cell is dirty */
const CommitBar = styled.div`
  display: flex;
  align-items: center;
  position: absolute;
  right: 12px;
  /* vertically aligned with formula bar (48px toolbar + formula bar starts) */
  top: 48px;
  z-index: 20;
  gap: 2px;
`;

const CommitBtn = styled.button`
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: ${C.greenDeep};
  background: rgba(164, 255, 17, 0.15);
  border: 1px solid rgba(164, 255, 17, 0.4);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.14s;

  &:hover { background: rgba(164, 255, 17, 0.3); }
`;

const CancelCommitBtn = styled.button`
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: ${C.danger};
  background: transparent;
  border: 1px solid ${C.line};
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.14s;

  &:hover { background: rgba(220, 38, 38, 0.08); }
`;

// ── Welcome gate ─────────────────────────────────────────────────

const FullCenter = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: ${C.paper};
`;

const WelcomeCard = styled.div`
  max-width: 460px;
  width: 100%;
  padding: 36px 32px;
  background: ${C.paper2};
  border: 1px solid ${C.line};
  border-radius: 20px;
  text-align: center;

  h2 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: ${C.ink};
    margin: 0 0 10px;
  }
  p {
    font-size: 14px;
    color: ${C.muted};
    margin: 0 0 24px;
    line-height: 1.6;
  }
`;

const WorkspaceList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 20px;
  max-height: 260px;
  overflow-y: auto;
  text-align: left;
`;

const WorkspaceRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  background: ${C.paper};
  border: 1px solid ${C.line};
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.14s, border-color 0.14s, transform 0.12s;

  &:hover {
    background: ${C.paper2};
    border-color: ${C.green};
    transform: translateY(-1px);
  }
`;

const WorkspaceMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const WorkspaceName = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: ${C.ink};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const WorkspaceId = styled.span`
  font-size: 11.5px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${C.mutedSoft};
`;

const OpenChevron = styled.span`
  font-size: 16px;
  color: ${C.green};
  flex-shrink: 0;
`;

const WelcomeIcon = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 16px;
  background: rgba(164, 255, 17, 0.14);
  border: 1px solid rgba(164, 255, 17, 0.4);
  display: grid;
  place-items: center;
  margin: 0 auto 20px;
  color: ${C.greenDeep};
`;

const ProjectNameInput = styled.input`
  width: 100%;
  padding: 11px 14px;
  font-size: 14px;
  color: ${C.ink};
  background: ${C.paper};
  border: 1px solid ${C.line};
  border-radius: 10px;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 20px;
  transition: border-color 0.15s, box-shadow 0.15s;

  &::placeholder { color: ${C.mutedSoft}; }
  &:focus {
    border-color: ${C.green};
    box-shadow: 0 0 0 3px rgba(164, 255, 17, 0.18);
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
`;

const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 11px 20px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  color: ${C.onAccent};
  background: ${C.green};
  border: 1px solid #93e60c;
  transition: background 0.18s, transform 0.15s;

  &:hover:not(:disabled) {
    background: ${C.greenHover};
    transform: translateY(-1px);
  }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const SecondaryBtn = styled.button`
  padding: 11px 18px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  color: ${C.ink};
  background: ${C.paper};
  border: 1px solid ${C.line};
  transition: background 0.15s, border-color 0.15s;

  &:hover { background: ${C.paper2}; border-color: ${C.green}; }
`;

const ErrLine = styled.p`
  margin: 12px 0 0;
  font-size: 13px;
  color: ${C.danger};
`;
