/**
 * SpreadsheetGrid — the main spreadsheet table.
 *
 * The whole sheet (1000 rows × 702 columns, A–ZZ) is virtualized: only the
 * rows and columns on screen are rendered, between spacers that keep the
 * scroll size true. Frozen rows and columns stay in view (sticky), and rows
 * and columns resize by dragging their header edge. With:
 *  - Sticky column headers (A, B, …) and row number column
 *  - Click-to-select cells, drag-to-select ranges, click a header to select a
 *    whole column/row (highlighted with blue accent)
 *  - Peer cursor overlays (colored border per collaborator)
 *  - "Point mode" while editing a formula: clicking/dragging cells (or headers)
 *    inserts their reference/range into the formula instead of moving selection
 *  - Displays computed_value for data cells, raw empty for blank cells
 *
 * All "what does this interaction mean?" decisions are delegated to the pure
 * `resolvePoint` router; the handlers here only translate DOM events into it.
 * Keyboard navigation: arrow keys move selection, Enter/Tab commit + move, F2
 * enters edit mode.
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { type Cell } from '../hooks/useSpreadsheet';
import type { PeerCursor } from '../spreadsheet/presence';
import { columnLabel, normalizeRect, type CellCoord, type Rect } from '../spreadsheet/refs';
import { resolvePoint, type PointAction } from '../spreadsheet/pointing';
import { formatValue } from '../spreadsheet/format';
import type { SheetViewAt } from '../hooks/useSpreadsheet';
import {
  AxisMetrics, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, GRID_COLS, GRID_ROWS, MAX_AXIS_SIZE,
  MIN_COL_WIDTH, MIN_ROW_HEIGHT, scrollToShow, visibleRange,
} from '../spreadsheet/viewport';

/** The column-header row and the row-number column. */
const HEADER_HEIGHT = 26;
const ROW_HEADER_WIDTH = 52;

// ── Types ────────────────────────────────────────────────────────────────────

interface SpreadsheetGridProps {
  sheetId: string | null;
  cells: Cell[];
  cursors: PeerCursor[];
  /** The badge shown on a peer's cursor, from their member id. */
  cursorLabel: (author: string) => string;
  /** "Edited by Ada, 5 min ago" for a cell, or null when unknown. */
  editedBy: (cell: Cell) => string | null;
  /** "row-col" of cells with an open comment thread; they get a corner mark. */
  commented: ReadonlySet<string>;
  /** "row-col" → the start of that cell's note; noted cells get a mark. */
  notes: ReadonlyMap<string, string>;
  /** Protected ranges on this sheet; `allowed` ones this user may still edit. */
  protectedRanges: readonly { rect: Rect; allowed: boolean }[];
  /** Frozen panes and resized rows and columns. */
  view: SheetViewAt;
  /** Resize a row or column (by position); absent where the sheet cannot be resized. */
  onResize?: (axis: 'row' | 'col', index: number, size: number) => void;
  /** Receives the grid's key handler, so the formula bar (which holds focus
   *  while a cell is selected) can pass navigation keys on. */
  keyHandlerRef?: React.MutableRefObject<((e: React.KeyboardEvent) => void) | null>;
  selectedCell: CellCoord | null;
  /** Committed multi-cell selection (column/row/range), highlighted. */
  selectionRange: Rect | null;
  /** In-progress formula-bar text for the selected cell while editing; shown
   *  live in the cell so you see what you type. `null` when not editing. */
  editingValue: string | null;
  /** Point mode: true while a formula is being edited. */
  pointMode: boolean;
  onPointRef: (ref: string) => void;
  onSelectCell: (row: number, col: number) => void;
  onSelectRange: (a: CellCoord, b: CellCoord) => void;
  onSelectColumn: (col: number) => void;
  onSelectRow: (row: number) => void;
  onEditCell: (row: number, col: number) => void;
  onOpenNote: (row: number, col: number) => void;
  onCommitAndMove: (direction: 'down' | 'right' | 'none') => void;
  onCellContextMenu?: (row: number, col: number, x: number, y: number) => void;
  onFill?: (source: Rect, target: Rect) => void;
  /** Clear the selection (Delete/Backspace) — a fallback for when the grid
   *  itself holds focus; the formula bar handles the common case. */
  onDelete?: () => void;
  /** Clear the copied-region outline (Escape) — same fallback role. */
  onClearClipboard?: () => void;
  copiedRegion?: { rect: Rect; cut: boolean } | null;
}

// ── Component ────────────────────────────────────────────────────────────────

function SpreadsheetGrid({
  sheetId,
  cells,
  cursors,
  cursorLabel,
  editedBy,
  commented,
  notes,
  protectedRanges,
  view,
  onResize,
  keyHandlerRef,
  selectedCell,
  selectionRange,
  editingValue,
  pointMode,
  onPointRef,
  onSelectCell,
  onSelectRange,
  onSelectColumn,
  onSelectRow,
  onEditCell,
  onOpenNote,
  onCommitAndMove,
  onCellContextMenu,
  onFill,
  onDelete,
  onClearClipboard,
  copiedRegion,
}: SpreadsheetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state: `anchor` is where the drag began; `dragRect` is the live
  // rectangle highlighted while dragging (both for range-select and point-mode).
  const dragAnchorRef = useRef<CellCoord | null>(null);
  // Shift-selection: `anchorRef` is where it started (the last plain
  // selection), `keyEndRef` the end Shift+arrows have moved to.
  const anchorRef = useRef<CellCoord | null>(null);
  const keyEndRef = useRef<CellCoord | null>(null);
  if (!selectionRange) { anchorRef.current = selectedCell; keyEndRef.current = null; }
  const [dragRect, setDragRect] = useState<Rect | null>(null);

  // Fill-drag: `fillAnchorRef` holds the source rect while the fill handle is
  // being dragged; `fillTarget` is the live target rect (source extended down
  // or right) highlighted with a dashed outline.
  const fillAnchorRef = useRef<Rect | null>(null);
  const [fillTarget, setFillTarget] = useState<Rect | null>(null);

  // Build lookup maps for O(1) access by "row-col" key
  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) {
      if (c.sheet_id === sheetId) m.set(`${c.row}-${c.col}`, c);
    }
    return m;
  }, [cells, sheetId]);

  const cursorMap = useMemo(() => {
    const m = new Map<string, PeerCursor>();
    for (const cur of cursors) {
      if (cur.sheet_id === sheetId) m.set(`${cur.row}-${cur.col}`, cur);
    }
    return m;
  }, [cursors, sheetId]);

  // Peers' selected ranges, tinted in their colour. Checked per rendered cell:
  // a whole-column range would be a thousand map entries.
  const peerRanges = useMemo(
    () => cursors.filter((cur) => cur.sheet_id === sheetId && cur.range),
    [cursors, sheetId],
  );
  const peerTintAt = (row: number, col: number) => peerRanges.find(({ range: r }) =>
    r && row >= r.top && row <= r.bottom && col >= r.left && col <= r.right)?.color;

  // ── Geometry: sizes (with a live resize drag on top), scroll, viewport ────
  const [liveResize, setLiveResize] = useState<{ axis: 'row' | 'col'; index: number; size: number } | null>(null);
  const rowMetrics = useMemo(() => {
    const sizes = new Map(view.rowSizes);
    if (liveResize?.axis === 'row') sizes.set(liveResize.index, liveResize.size);
    return new AxisMetrics(GRID_ROWS, DEFAULT_ROW_HEIGHT, sizes);
  }, [view.rowSizes, liveResize]);
  const colMetrics = useMemo(() => {
    const sizes = new Map(view.colSizes);
    if (liveResize?.axis === 'col') sizes.set(liveResize.index, liveResize.size);
    return new AxisMetrics(GRID_COLS, DEFAULT_COL_WIDTH, sizes);
  }, [view.colSizes, liveResize]);
  const frozenRows = Math.min(view.frozenRows, GRID_ROWS);
  const frozenCols = Math.min(view.frozenCols, GRID_COLS);

  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scrollFrame = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const el = containerRef.current;
      if (el) setScroll({ top: el.scrollTop, left: el.scrollLeft });
    });
  }, []);
  // A new sheet starts at its top-left.
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0, left: 0 });
  }, [sheetId]);

  const bodyHeight = viewport.height - HEADER_HEIGHT;
  const bodyWidth = viewport.width - ROW_HEADER_WIDTH;
  const rowRange = visibleRange(rowMetrics, frozenRows, scroll.top, bodyHeight);
  const colRange = visibleRange(colMetrics, frozenCols, scroll.left, bodyWidth);

  // Keep the selected cell (the moving end of a keyboard selection) in view.
  const focusCell = keyEndRef.current ?? selectedCell;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !focusCell) return;
    const top = scrollToShow(rowMetrics, frozenRows, focusCell.row, el.scrollTop, bodyHeight);
    const left = scrollToShow(colMetrics, frozenCols, focusCell.col, el.scrollLeft, bodyWidth);
    if (top !== el.scrollTop || left !== el.scrollLeft) el.scrollTo({ top, left });
    // Only when the selection moves, not on every resize or scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCell?.row, focusCell?.col]);

  // ── Resizing: drag a header's edge ───────────────────────────────────────
  const startResize = (e: React.MouseEvent, axis: 'row' | 'col', index: number) => {
    if (!onResize) return;
    e.preventDefault();
    e.stopPropagation();
    const origin = axis === 'col' ? e.clientX : e.clientY;
    const start = axis === 'col' ? colMetrics.size(index) : rowMetrics.size(index);
    const min = axis === 'col' ? MIN_COL_WIDTH : MIN_ROW_HEIGHT;
    let size = start;
    const move = (ev: MouseEvent) => {
      size = Math.max(min, Math.min(MAX_AXIS_SIZE, start + (axis === 'col' ? ev.clientX : ev.clientY) - origin));
      setLiveResize({ axis, index, size });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setLiveResize(null);
      if (size !== start) onResize(axis, index, size);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Dispatch a resolved point action to the right callback.
  const dispatch = useCallback(
    (action: PointAction) => {
      switch (action.action) {
        case 'select-cell':
          onSelectCell(action.row, action.col);
          break;
        case 'select-range':
          onSelectRange(action.a, action.b);
          break;
        case 'select-column':
          onSelectColumn(action.col);
          break;
        case 'select-row':
          onSelectRow(action.row);
          break;
        case 'insert-ref':
          onPointRef(action.ref);
          break;
      }
    },
    [onSelectCell, onSelectRange, onSelectColumn, onSelectRow, onPointRef],
  );

  const cellFromEvent = (e: React.MouseEvent): CellCoord | null => {
    const td = (e.target as Element).closest('td[data-row]') as HTMLElement | null;
    if (!td) return null;
    return {
      row: parseInt(td.dataset.row ?? '0', 10),
      col: parseInt(td.dataset.col ?? '0', 10),
    };
  };

  // Extend `source` toward `cell` along whichever axis was dragged farther.
  const computeFillTarget = (source: Rect, cell: CellCoord): Rect => {
    const down = Math.max(0, cell.row - source.bottom);
    const right = Math.max(0, cell.col - source.right);
    if (down >= right && down > 0) return { ...source, bottom: cell.row };
    if (right > 0) return { ...source, right: cell.col };
    return source;
  };

  const handleFillStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // don't start a selection drag
      e.preventDefault();
      const src =
        selectionRange ??
        (selectedCell
          ? { top: selectedCell.row, left: selectedCell.col, bottom: selectedCell.row, right: selectedCell.col }
          : null);
      if (!src) return;
      fillAnchorRef.current = src;
      setFillTarget(src);
    },
    [selectionRange, selectedCell],
  );

  // ── Cell pointer handling (select-drag OR point-drag) ─────────────────────
  const handleCellMouseDown = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      const cell = cellFromEvent(e);
      if (!cell) return;
      if (pointMode) {
        // Keep the formula input focused so its caret survives the click.
        e.preventDefault();
      } else if (e.shiftKey && anchorRef.current) {
        // Shift-click: extend from where the selection started.
        e.preventDefault();
        keyEndRef.current = cell;
        onSelectRange(anchorRef.current, cell);
        return;
      } else {
        // Move selection immediately on press (single-click select). The formula
        // bar auto-focuses on selection and owns clipboard/Delete when not editing.
        onSelectCell(cell.row, cell.col);
      }
      dragAnchorRef.current = cell;
      setDragRect(normalizeRect(cell, cell));
    },
    [pointMode, onSelectCell, onSelectRange],
  );

  const handleCellMouseOver = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (fillAnchorRef.current) {
        const cell = cellFromEvent(e);
        if (cell) setFillTarget(computeFillTarget(fillAnchorRef.current, cell));
        return;
      }
      const anchor = dragAnchorRef.current;
      if (!anchor) return;
      const cell = cellFromEvent(e);
      if (!cell) return;
      setDragRect(normalizeRect(anchor, cell));
      // Live-extend the selection while dragging (non-point mode only; in point
      // mode we commit the reference on mouse-up to avoid thrashing the input).
      if (!pointMode) onSelectRange(anchor, cell);
    },
    [pointMode, onSelectRange],
  );

  const handleCellMouseUp = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (fillAnchorRef.current) {
        const src = fillAnchorRef.current;
        const tgt = fillTarget ?? src;
        fillAnchorRef.current = null;
        setFillTarget(null);
        if (tgt.bottom > src.bottom || tgt.right > src.right) onFill?.(src, tgt);
        return;
      }
      const anchor = dragAnchorRef.current;
      if (!anchor) return;
      const end = cellFromEvent(e) ?? anchor;
      const isRange = end.row !== anchor.row || end.col !== anchor.col;
      dispatch(
        resolvePoint({
          pointMode,
          target: { kind: 'cell', a: anchor, b: isRange ? end : undefined },
        }),
      );
      dragAnchorRef.current = null;
      setDragRect(null);
    },
    [pointMode, dispatch, fillTarget, onFill],
  );

  const handleCellDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      const cell = cellFromEvent(e);
      if (cell) onEditCell(cell.row, cell.col);
    },
    [onEditCell],
  );

  // Header clicks: whole-column / whole-row select, or ref insertion in point
  // mode. No drag, so route straight through the resolver.
  const handleColHeader = useCallback(
    (e: React.MouseEvent, col: number) => {
      if (pointMode) e.preventDefault();
      dispatch(resolvePoint({ pointMode, target: { kind: 'column', col } }));
    },
    [pointMode, dispatch],
  );
  const handleRowHeader = useCallback(
    (e: React.MouseEvent, row: number) => {
      if (pointMode) e.preventDefault();
      dispatch(resolvePoint({ pointMode, target: { kind: 'row', row } }));
    },
    [pointMode, dispatch],
  );

  // Keyboard navigation on the grid container
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedCell) return;
      const { row, col } = selectedCell;
      const page = Math.max(1, Math.floor(bodyHeight / DEFAULT_ROW_HEIGHT) - 1);
      const step: Record<string, [number, number]> = {
        ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
        PageUp: [-page, 0], PageDown: [page, 0],
      };
      if (e.key in step) {
        e.preventDefault();
        const [dr, dc] = step[e.key];
        const from = e.shiftKey ? keyEndRef.current ?? selectedCell : selectedCell;
        const to = {
          row: Math.max(0, Math.min(GRID_ROWS - 1, from.row + dr)),
          col: Math.max(0, Math.min(GRID_COLS - 1, from.col + dc)),
        };
        if (e.shiftKey && anchorRef.current) {
          keyEndRef.current = to;
          onSelectRange(anchorRef.current, to);
        } else {
          onSelectCell(to.row, to.col);
        }
        return;
      }
      switch (e.key) {
        case 'F2':
          e.preventDefault();
          // Shift+F2 opens the cell's note, as in other spreadsheets.
          if (e.shiftKey) onOpenNote(row, col);
          else onEditCell(row, col);
          break;
        case 'Enter':
          e.preventDefault();
          onCommitAndMove('down');
          break;
        case 'Tab':
          e.preventDefault();
          onCommitAndMove('right');
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          onDelete?.();
          break;
        case 'Escape':
          onClearClipboard?.();
          break;
        default:
          break;
      }
    },
    [selectedCell, bodyHeight, onSelectCell, onSelectRange, onEditCell, onOpenNote, onCommitAndMove, onDelete, onClearClipboard],
  );
  useEffect(() => {
    if (keyHandlerRef) keyHandlerRef.current = handleKeyDown;
  }, [keyHandlerRef, handleKeyDown]);

  // The rectangle to highlight: the live drag while dragging, else the
  // committed multi-cell selection.
  const highlightRect = dragRect ?? selectionRange;

  const rows = [
    ...Array.from({ length: frozenRows }, (_, i) => i),
    ...Array.from({ length: rowRange.end - rowRange.start }, (_, i) => rowRange.start + i),
  ];
  const cols = [
    ...Array.from({ length: frozenCols }, (_, i) => i),
    ...Array.from({ length: colRange.end - colRange.start }, (_, i) => colRange.start + i),
  ];
  const leftGap = colMetrics.offset(colRange.start) - colMetrics.offset(frozenCols);
  const rightGap = colMetrics.total - colMetrics.offset(colRange.end);
  const topGap = rowMetrics.offset(rowRange.start) - rowMetrics.offset(frozenRows);
  const bottomGap = rowMetrics.total - rowMetrics.offset(rowRange.end);

  // Frozen rows and columns stick below the header and beside the row numbers.
  const stickyRow = (row: number): React.CSSProperties =>
    row < frozenRows ? { position: 'sticky', top: HEADER_HEIGHT + rowMetrics.offset(row), zIndex: 2 } : {};
  const stickyCol = (col: number): React.CSSProperties =>
    col < frozenCols ? { position: 'sticky', left: ROW_HEADER_WIDTH + colMetrics.offset(col), zIndex: 2 } : {};
  const frozenEdge = (row: number, col: number): React.CSSProperties => ({
    ...(row === frozenRows - 1 ? { borderBottom: `2px solid ${C.muted}` } : {}),
    ...(col === frozenCols - 1 ? { borderRight: `2px solid ${C.muted}` } : {}),
  });

  const selBottom = selectionRange ? selectionRange.bottom : selectedCell?.row;
  const selRight = selectionRange ? selectionRange.right : selectedCell?.col;

  const renderCell = (row: number, col: number) => {
    const key = `${row}-${col}`;
    const cell = cellMap.get(key);
    const cursor = cursorMap.get(key);
    const isSelected = selectedCell?.row === row && selectedCell?.col === col;
    const inRange = highlightRect !== null &&
      row >= highlightRect.top && row <= highlightRect.bottom &&
      col >= highlightRect.left && col <= highlightRect.right;
    const inFillTarget = fillTarget !== null &&
      row >= fillTarget.top && row <= fillTarget.bottom &&
      col >= fillTarget.left && col <= fillTarget.right &&
      !(selectionRange
        ? row >= selectionRange.top && row <= selectionRange.bottom &&
          col >= selectionRange.left && col <= selectionRange.right
        : isSelected);
    const copiedHere = copiedRegion != null &&
      row >= copiedRegion.rect.top && row <= copiedRegion.rect.bottom &&
      col >= copiedRegion.rect.left && col <= copiedRegion.rect.right;
    const copiedKind = copiedHere ? (copiedRegion!.cut ? 'cut' : 'copy') : undefined;
    // The handle sits on the selection's bottom-right cell.
    const isFillCorner = !pointMode && editingValue === null && row === selBottom && col === selRight &&
      (isSelected || (selectionRange != null && inRange));
    const isEditingThis = isSelected && editingValue !== null;
    const shownValue = isEditingThis ? editingValue : formatValue(cell?.computed_value ?? '', cell?.format ?? '');
    const shownIsFormula = isEditingThis ? editingValue.startsWith('=') : (cell?.raw_value.startsWith('=') ?? false);
    const sticky = { ...stickyRow(row), ...stickyCol(col) };
    if (row < frozenRows && col < frozenCols) sticky.zIndex = 3;

    return (
      <DataCell
        key={col}
        data-row={row}
        data-col={col}
        data-testid="item-cell"
        $selected={isSelected}
        $cursorColor={cursor?.color}
        $peerTint={peerTintAt(row, col)}
        $inRange={inRange && !isSelected}
        $inFillTarget={inFillTarget}
        $copied={copiedKind}
        $locked={lockAt(protectedRanges, row, col)}
        style={{ ...sticky, ...frozenEdge(row, col) }}
        aria-selected={isSelected}
        role="gridcell"
        onContextMenu={(e) => {
          if (!onCellContextMenu) return;
          e.preventDefault();
          onCellContextMenu(row, col, e.clientX, e.clientY);
        }}
        title={cellTitle(`${columnLabel(col)}${row + 1}`, cell, editedBy, notes.get(key))}
      >
        <CellValue $isFormula={shownIsFormula}>{shownValue}</CellValue>
        {notes.has(key) && <NoteMark data-testid="note-mark" aria-label="Has a note" />}
        {commented.has(key) && <CommentMark data-testid="comment-mark" aria-label="Has comments" />}
        {cursor && !isSelected && (
          <CursorTag style={{ background: cursor.color }}>{cursorLabel(cursor.author)}</CursorTag>
        )}
        {isFillCorner && <FillHandle data-testid="fill-handle" onMouseDown={handleFillStart} aria-label="Fill handle" />}
      </DataCell>
    );
  };

  const colSelected = (col: number) => selectedCell?.col === col ||
    (!!highlightRect && highlightRect.left <= col && col <= highlightRect.right);
  const rowSelected = (row: number) => selectedCell?.row === row ||
    (!!highlightRect && highlightRect.top <= row && row <= highlightRect.bottom);

  return (
    <GridContainer
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onScroll={handleScroll}
      aria-label="Spreadsheet grid"
      aria-rowcount={GRID_ROWS}
      aria-colcount={GRID_COLS}
      role="grid"
    >
      <Table role="presentation" style={{ width: ROW_HEADER_WIDTH + colMetrics.total }}>
        <colgroup>
          <col style={{ width: ROW_HEADER_WIDTH }} />
          {cols.slice(0, frozenCols).map((c) => <col key={c} style={{ width: colMetrics.size(c) }} />)}
          {leftGap > 0 && <col style={{ width: leftGap }} />}
          {cols.slice(frozenCols).map((c) => <col key={c} style={{ width: colMetrics.size(c) }} />)}
          {rightGap > 0 && <col style={{ width: rightGap }} />}
        </colgroup>

        {/* Column headers — sticky, clickable, resizable at the right edge */}
        <thead>
          <tr style={{ height: HEADER_HEIGHT }}>
            <CornerTh aria-label="Row / Column" />
            {cols.map((col, i) => (
              <React.Fragment key={col}>
                {i === frozenCols && leftGap > 0 && <GapTh aria-hidden="true" />}
                <ColTh
                  $selected={colSelected(col)}
                  style={col < frozenCols ? { left: ROW_HEADER_WIDTH + colMetrics.offset(col), zIndex: 4, ...frozenEdge(-1, col) } : undefined}
                  onMouseDown={(e) => handleColHeader(e, col)}
                  aria-label={`Column ${columnLabel(col)}`}
                  data-col={col}
                >
                  {columnLabel(col)}
                  {onResize && (
                    <ResizeHandle
                      $axis="col"
                      onMouseDown={(e) => startResize(e, 'col', col)}
                      aria-label={`Resize column ${columnLabel(col)}`}
                      data-testid="resize-col"
                    />
                  )}
                </ColTh>
              </React.Fragment>
            ))}
            {rightGap > 0 && <GapTh aria-hidden="true" />}
          </tr>
        </thead>

        {/* Rows */}
        <tbody
          onMouseDown={handleCellMouseDown}
          onMouseOver={handleCellMouseOver}
          onMouseUp={handleCellMouseUp}
          onDoubleClick={handleCellDoubleClick}
        >
          {rows.map((row, i) => (
            <React.Fragment key={row}>
              {i === frozenRows && topGap > 0 && <tr aria-hidden="true" style={{ height: topGap }} />}
              <tr style={{ height: rowMetrics.size(row) }}>
                <RowTh
                  $selected={rowSelected(row)}
                  style={row < frozenRows ? { top: HEADER_HEIGHT + rowMetrics.offset(row), zIndex: 3, ...frozenEdge(row, -1) } : undefined}
                  onMouseDown={(e) => handleRowHeader(e, row)}
                  aria-label={`Row ${row + 1}`}
                >
                  {row + 1}
                  {onResize && (
                    <ResizeHandle
                      $axis="row"
                      onMouseDown={(e) => startResize(e, 'row', row)}
                      aria-label={`Resize row ${row + 1}`}
                      data-testid="resize-row"
                    />
                  )}
                </RowTh>
                {cols.map((col, j) => (
                  <React.Fragment key={col}>
                    {j === frozenCols && leftGap > 0 && <GapTd aria-hidden="true" style={stickyRow(row)} />}
                    {renderCell(row, col)}
                  </React.Fragment>
                ))}
                {rightGap > 0 && <GapTd aria-hidden="true" style={stickyRow(row)} />}
              </tr>
            </React.Fragment>
          ))}
          {bottomGap > 0 && <tr aria-hidden="true" style={{ height: bottomGap }} />}
        </tbody>
      </Table>
    </GridContainer>
  );
}

export default memo(SpreadsheetGrid);

/** How a cell shows protection: stopped for this user, protected but theirs, or not. */
function lockAt(ranges: readonly { rect: Rect; allowed: boolean }[], row: number, col: number): 'blocked' | 'allowed' | undefined {
  let found: 'blocked' | 'allowed' | undefined;
  for (const { rect, allowed } of ranges) {
    if (row < rect.top || row > rect.bottom || col < rect.left || col > rect.right) continue;
    if (!allowed) return 'blocked';
    found = 'allowed';
  }
  return found;
}

/** A cell's tooltip: its raw value, who last edited it, and its note. */
function cellTitle(ref: string, cell: Cell | undefined, editedBy: (cell: Cell) => string | null, note: string | undefined) {
  const lines = [
    cell && `${ref}: ${cell.raw_value}`,
    cell && editedBy(cell),
    note && `Note: ${note}`,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : undefined;
}

// ── Styled components ────────────────────────────────────────────────────────

const ACCENT = C.green; // green selection accent (matches landing mockup)
const ACCENT_TEXT = C.greenDeep; // readable green for selected header labels

const GridContainer = styled.div`
  flex: 1;
  overflow: auto;
  position: relative;
  outline: none;
  background: ${C.paper};
  scrollbar-width: thin;
  scrollbar-color: ${C.line} transparent;
  &::-webkit-scrollbar { width: 8px; height: 8px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 4px; }
`;

const Table = styled.table`
  border-collapse: collapse;
  table-layout: fixed;
  margin-bottom: 60px;
  user-select: none;
`;

const CornerTh = styled.th`
  position: sticky;
  top: 0;
  left: 0;
  z-index: 5;
  background: ${C.paper2};
  border-right: 2px solid ${C.line};
  border-bottom: 2px solid ${C.line};
  width: 52px;
  min-width: 52px;
`;

const ColTh = styled.th<{ $selected: boolean }>`
  position: sticky;
  top: 0;
  z-index: 2;
  /* Opaque, tint as an inset shadow: frozen headers sit over scrolled ones. */
  background: ${C.paper2};
  box-shadow: ${(p) => (p.$selected ? 'inset 0 0 0 999px rgba(164,255,17,0.12)' : 'none')};
  border-right: 1px solid ${C.line};
  border-bottom: 2px solid ${C.line};
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: ${(p) => (p.$selected ? ACCENT_TEXT : C.muted)};
  padding: 4px 2px;
  cursor: pointer;
  user-select: none;
  overflow: hidden;
  white-space: nowrap;
  transition: background 0.1s, color 0.1s;
  &:hover { box-shadow: inset 0 0 0 999px rgba(164,255,17,0.10); }
`;

/** The strip at a header's edge that resizes its row or column. */
const ResizeHandle = styled.span<{ $axis: 'row' | 'col' }>`
  position: absolute;
  ${(p) => (p.$axis === 'col'
    ? 'top: 0; right: -3px; width: 7px; height: 100%; cursor: col-resize;'
    : 'left: 0; bottom: -3px; height: 7px; width: 100%; cursor: row-resize;')}
  z-index: 1;
  &:hover { background: ${C.green}; opacity: 0.6; }
`;

/** Header and body cells standing in for the columns scrolled out of view. */
const GapTh = styled.th`
  position: sticky; top: 0; z-index: 1;
  background: ${C.paper2}; border-bottom: 2px solid ${C.line};
`;
const GapTd = styled.td`
  padding: 0; border: none; background: ${C.paper};
`;

const RowTh = styled.td<{ $selected: boolean }>`
  position: sticky;
  left: 0;
  z-index: 2;
  /* Opaque, tint as an inset shadow: frozen headers sit over scrolled ones. */
  background: ${C.paper2};
  box-shadow: ${(p) => (p.$selected ? 'inset 0 0 0 999px rgba(164,255,17,0.12)' : 'none')};
  border-right: 2px solid ${C.line};
  border-bottom: 1px solid ${C.line};
  text-align: center;
  font-size: 11px;
  font-weight: 500;
  color: ${(p) => (p.$selected ? ACCENT_TEXT : C.muted)};
  padding: 2px 4px;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s, color 0.1s;
  &:hover { box-shadow: inset 0 0 0 999px rgba(164,255,17,0.10); }
`;

const DataCell = styled.td<{ $selected: boolean; $cursorColor?: string; $peerTint?: string; $inRange?: boolean; $inFillTarget?: boolean; $copied?: 'copy' | 'cut'; $locked?: 'blocked' | 'allowed' }>`
  padding: 0 4px;
  font-size: 13px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${C.ink};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: 1px solid ${C.line};
  border-bottom: 1px solid ${C.line};
  cursor: cell;
  position: relative;
  background: ${C.paper};
  box-sizing: border-box;

  ${(p) =>
    p.$selected &&
    `
    outline: 2px solid ${ACCENT};
    outline-offset: -2px;
    box-shadow: inset 0 0 0 999px rgba(164, 255, 17, 0.06);
    z-index: 1;
  `}

  ${(p) =>
    p.$cursorColor && !p.$selected &&
    `
    outline: 2px solid ${p.$cursorColor};
    outline-offset: -2px;
    z-index: 1;
  `}

  ${(p) =>
    p.$peerTint && !p.$selected &&
    `
    background: color-mix(in srgb, ${p.$peerTint} 12%, ${C.paper});
  `}

  ${(p) =>
    p.$inRange &&
    `
    box-shadow: inset 0 0 0 999px rgba(164, 255, 17, 0.12);
  `}

  ${(p) => p.$locked && `background-image: repeating-linear-gradient(135deg, transparent 0 6px, ${p.$locked === 'blocked' ? 'rgba(128, 128, 128, 0.16)' : 'rgba(164, 255, 17, 0.08)'} 6px 7px);`}

  ${(p) => p.$inFillTarget && `outline: 1px dashed ${C.green}; outline-offset: -1px;`}

  ${(p) => p.$copied === 'copy' && `outline: 1px dashed ${C.ink}; outline-offset: -1px;`}
  ${(p) => p.$copied === 'cut' && `outline: 1px dashed ${C.muted}; outline-offset: -1px;`}

  &:hover:not([aria-selected='true']) {
    background: ${C.paper2};
  }
`;

const NoteMark = styled.span`
  position: absolute; top: 0; left: 0;
  border-style: solid; border-width: 6px 6px 0 0;
  border-color: ${C.muted} transparent transparent transparent;
  pointer-events: none;
`;

const CommentMark = styled.span`
  position: absolute; top: 0; right: 0;
  border-style: solid; border-width: 0 7px 7px 0;
  border-color: transparent ${C.green} transparent transparent;
  pointer-events: none;
`;

const FillHandle = styled.div`
  position: absolute;
  /* Sit flush in the cell's inner bottom-right corner. DataCell has
     overflow:hidden (for text-ellipsis), so a negative offset would clip the
     handle to a sliver — keep it fully inside the box. */
  right: 0;
  bottom: 0;
  width: 7px;
  height: 7px;
  background: ${C.green};
  border: 1px solid ${C.paper};
  border-radius: 1px;
  cursor: crosshair;
  z-index: 5;
`;

const CellValue = styled.div<{ $isFormula: boolean }>`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${(p) => (p.$isFormula ? C.greenDeep : 'inherit')};
`;

const CursorTag = styled.div`
  position: absolute;
  top: -1px;
  right: 0;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  padding: 1px 3px;
  border-radius: 0 0 0 4px;
  line-height: 1.4;
  pointer-events: none;
  text-transform: uppercase;
`;
