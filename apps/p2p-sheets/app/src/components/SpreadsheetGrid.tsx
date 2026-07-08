/**
 * SpreadsheetGrid — the main spreadsheet table.
 *
 * Renders a 50-row × 26-column (A–Z) grid with:
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
import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { type Cell, type Cursor } from '../hooks/useSpreadsheet';
import { columnLabel, normalizeRect, type CellCoord, type Rect } from '../spreadsheet/refs';
import { resolvePoint, type PointAction } from '../spreadsheet/pointing';

const ROWS = 50;
const COLS = 26; // A–Z

// ── Types ────────────────────────────────────────────────────────────────────

interface SpreadsheetGridProps {
  sheetId: string | null;
  cells: Cell[];
  cursors: Cursor[];
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
  onCommitAndMove: (direction: 'down' | 'right' | 'none') => void;
}

// ── Component ────────────────────────────────────────────────────────────────

function SpreadsheetGrid({
  sheetId,
  cells,
  cursors,
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
  onCommitAndMove,
}: SpreadsheetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state: `anchor` is where the drag began; `dragRect` is the live
  // rectangle highlighted while dragging (both for range-select and point-mode).
  const dragAnchorRef = useRef<CellCoord | null>(null);
  const [dragRect, setDragRect] = useState<Rect | null>(null);

  // Build lookup maps for O(1) access by "row-col" key
  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) {
      if (c.sheet_id === sheetId) m.set(`${c.row}-${c.col}`, c);
    }
    return m;
  }, [cells, sheetId]);

  const cursorMap = useMemo(() => {
    const m = new Map<string, Cursor>();
    for (const cur of cursors) {
      if (cur.sheet_id === sheetId) m.set(`${cur.row}-${cur.col}`, cur);
    }
    return m;
  }, [cursors, sheetId]);

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

  // ── Cell pointer handling (select-drag OR point-drag) ─────────────────────
  const handleCellMouseDown = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      const cell = cellFromEvent(e);
      if (!cell) return;
      if (pointMode) {
        // Keep the formula input focused so its caret survives the click.
        e.preventDefault();
      } else {
        // Move selection immediately on press (single-click select).
        onSelectCell(cell.row, cell.col);
      }
      dragAnchorRef.current = cell;
      setDragRect(normalizeRect(cell, cell));
    },
    [pointMode, onSelectCell],
  );

  const handleCellMouseOver = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
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
    [pointMode, dispatch],
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
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selectedCell) return;
      const { row, col } = selectedCell;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          if (row > 0) onSelectCell(row - 1, col);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (row < ROWS - 1) onSelectCell(row + 1, col);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (col > 0) onSelectCell(row, col - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (col < COLS - 1) onSelectCell(row, col + 1);
          break;
        case 'F2':
          e.preventDefault();
          onEditCell(row, col);
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
          // Handled in AppPage (clears the cell)
          break;
        default:
          break;
      }
    },
    [selectedCell, onSelectCell, onEditCell, onCommitAndMove],
  );

  // The rectangle to highlight: the live drag while dragging, else the
  // committed multi-cell selection.
  const highlightRect = dragRect ?? selectionRange;

  return (
    <GridContainer
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Spreadsheet grid"
      role="grid"
    >
      <Table role="presentation">
        <colgroup>
          <col style={{ width: '52px', minWidth: '52px' }} />
          {Array.from({ length: COLS }, (_, i) => (
            <col key={i} style={{ width: '100px', minWidth: '60px' }} />
          ))}
        </colgroup>

        {/* Column headers — sticky, clickable */}
        <thead>
          <tr>
            <CornerTh aria-label="Row / Column" />
            {Array.from({ length: COLS }, (_, col) => (
              <ColTh
                key={col}
                $selected={
                  selectedCell?.col === col ||
                  (!!highlightRect && highlightRect.left <= col && col <= highlightRect.right)
                }
                onMouseDown={(e) => handleColHeader(e, col)}
                aria-label={`Column ${columnLabel(col)}`}
              >
                {columnLabel(col)}
              </ColTh>
            ))}
          </tr>
        </thead>

        {/* Rows */}
        <tbody
          onMouseDown={handleCellMouseDown}
          onMouseOver={handleCellMouseOver}
          onMouseUp={handleCellMouseUp}
          onDoubleClick={handleCellDoubleClick}
        >
          {Array.from({ length: ROWS }, (_, row) => (
            <tr key={row}>
              <RowTh
                $selected={
                  selectedCell?.row === row ||
                  (!!highlightRect && highlightRect.top <= row && row <= highlightRect.bottom)
                }
                onMouseDown={(e) => handleRowHeader(e, row)}
                aria-label={`Row ${row + 1}`}
              >
                {row + 1}
              </RowTh>

              {Array.from({ length: COLS }, (_, col) => {
                const key = `${row}-${col}`;
                const cell = cellMap.get(key);
                const cursor = cursorMap.get(key);
                const isSelected =
                  selectedCell?.row === row && selectedCell?.col === col;

                const inRange =
                  highlightRect !== null &&
                  row >= highlightRect.top &&
                  row <= highlightRect.bottom &&
                  col >= highlightRect.left &&
                  col <= highlightRect.right;

                const isEditingThis = isSelected && editingValue !== null;
                const shownValue = isEditingThis
                  ? editingValue
                  : (cell?.computed_value ?? '');
                const shownIsFormula = isEditingThis
                  ? editingValue.startsWith('=')
                  : (cell?.raw_value.startsWith('=') ?? false);

                return (
                  <DataCell
                    key={col}
                    data-row={row}
                    data-col={col}
                    data-testid="item-cell"
                    $selected={isSelected}
                    $cursorColor={cursor?.color}
                    $inRange={inRange && !isSelected}
                    aria-selected={isSelected}
                    role="gridcell"
                    title={cell ? `${columnLabel(col)}${row + 1}: ${cell.raw_value}` : undefined}
                  >
                    <CellValue $isFormula={shownIsFormula}>{shownValue}</CellValue>
                    {cursor && !isSelected && (
                      <CursorTag style={{ background: cursor.color }}>
                        {cursor.author.slice(0, 3)}
                      </CursorTag>
                    )}
                  </DataCell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </GridContainer>
  );
}

export default memo(SpreadsheetGrid);

// ── Styled components ────────────────────────────────────────────────────────

const ACCENT = '#3B82F6'; // blue accent for selection (spec accent color)

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
  z-index: 3;
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
  background: ${(p) => (p.$selected ? 'rgba(59,130,246,0.1)' : C.paper2)};
  border-right: 1px solid ${C.line};
  border-bottom: 2px solid ${C.line};
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: ${(p) => (p.$selected ? ACCENT : C.muted)};
  padding: 4px 2px;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s, color 0.1s;
  &:hover { background: rgba(59,130,246,0.14); }
`;

const RowTh = styled.td<{ $selected: boolean }>`
  position: sticky;
  left: 0;
  z-index: 1;
  background: ${(p) => (p.$selected ? 'rgba(59,130,246,0.1)' : C.paper2)};
  border-right: 2px solid ${C.line};
  border-bottom: 1px solid ${C.line};
  text-align: center;
  font-size: 11px;
  font-weight: 500;
  color: ${(p) => (p.$selected ? ACCENT : C.muted)};
  padding: 2px 4px;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s, color 0.1s;
  &:hover { background: rgba(59,130,246,0.14); }
`;

const DataCell = styled.td<{ $selected: boolean; $cursorColor?: string; $inRange?: boolean }>`
  height: 24px;
  min-width: 60px;
  max-width: 200px;
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
    background: rgba(59, 130, 246, 0.04);
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
    p.$inRange &&
    `
    background: rgba(59, 130, 246, 0.14);
  `}

  &:hover:not([aria-selected='true']) {
    background: ${C.paper2};
  }
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
