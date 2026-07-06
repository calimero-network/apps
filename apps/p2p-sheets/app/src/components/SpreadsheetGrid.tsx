/**
 * SpreadsheetGrid — the main spreadsheet table.
 *
 * Renders a 50-row × 26-column (A–Z) grid with:
 *  - Sticky column headers (A, B, …) and row number column
 *  - Click-to-select cells (highlighted with blue accent border)
 *  - Peer cursor overlays (colored border per collaborator)
 *  - Displays computed_value for data cells, raw empty for blank cells
 *
 * The formula bar (FormulaBar component) handles all editing input.
 * Keyboard navigation: arrow keys move selection, Enter moves down, Tab moves right.
 */
import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { type Cell, type Cursor } from '../hooks/useSpreadsheet';

const ROWS = 50;
const COLS = 26; // A–Z

// ── Helpers ──────────────────────────────────────────────────────────────────

function colLetter(col: number): string {
  return String.fromCharCode(65 + col);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface SpreadsheetGridProps {
  sheetId: string | null;
  cells: Cell[];
  cursors: Cursor[];
  selectedCell: { row: number; col: number } | null;
  /** In-progress formula-bar text for the selected cell while editing; shown
   *  live in the cell so you see what you type. `null` when not editing. */
  editingValue: string | null;
  /** Point mode: true while a formula is being edited. In this mode clicking or
   *  dragging cells inserts their reference/range into the formula (via
   *  `onPointRef`) instead of moving the selection. */
  pointMode: boolean;
  onPointRef: (ref: string) => void;
  onSelectCell: (row: number, col: number) => void;
  onCommitAndMove: (direction: 'down' | 'right' | 'none') => void;
}

/** `A1`-style reference for a 0-indexed cell. */
function cellRefStr(row: number, col: number): string {
  return `${colLetter(col)}${row + 1}`;
}

/** Reference for a rectangular range between two cells (single ref if equal). */
function rangeRefStr(a: { row: number; col: number }, b: { row: number; col: number }): string {
  if (a.row === b.row && a.col === b.col) return cellRefStr(a.row, a.col);
  const tl = { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) };
  const br = { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) };
  return `${cellRefStr(tl.row, tl.col)}:${cellRefStr(br.row, br.col)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

function SpreadsheetGrid({
  sheetId,
  cells,
  cursors,
  selectedCell,
  editingValue,
  pointMode,
  onPointRef,
  onSelectCell,
  onCommitAndMove,
}: SpreadsheetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Point-mode drag state: anchor is where the drag began; `pointRange` is the
  // live rectangle used to highlight the range being pointed at.
  const dragAnchorRef = useRef<{ row: number; col: number } | null>(null);
  const [pointRange, setPointRange] = useState<
    { a: { row: number; col: number }; b: { row: number; col: number } } | null
  >(null);

  // Build lookup maps for O(1) access by "row-col" key
  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) {
      if (c.sheet_id === sheetId) {
        m.set(`${c.row}-${c.col}`, c);
      }
    }
    return m;
  }, [cells, sheetId]);

  const cursorMap = useMemo(() => {
    const m = new Map<string, Cursor>();
    for (const cur of cursors) {
      if (cur.sheet_id === sheetId) {
        m.set(`${cur.row}-${cur.col}`, cur);
      }
    }
    return m;
  }, [cursors, sheetId]);

  const cellFromEvent = (
    e: React.MouseEvent,
  ): { row: number; col: number } | null => {
    const td = (e.target as Element).closest('td[data-row]') as HTMLElement | null;
    if (!td) return null;
    return {
      row: parseInt(td.dataset.row ?? '0', 10),
      col: parseInt(td.dataset.col ?? '0', 10),
    };
  };

  // Event delegation: one click handler on the table body. In point mode the
  // drag handlers below own cell interaction, so click does nothing here.
  const handleTableClick = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (pointMode) return;
      const cell = cellFromEvent(e);
      if (cell) onSelectCell(cell.row, cell.col);
    },
    [onSelectCell, pointMode],
  );

  // ── Point-mode drag: insert a cell/range reference into the formula ────────
  const handleTableMouseDown = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (!pointMode) return;
      const cell = cellFromEvent(e);
      if (!cell) return;
      // Don't blur the focused formula input — keep its caret for insertion.
      e.preventDefault();
      dragAnchorRef.current = cell;
      setPointRange({ a: cell, b: cell });
    },
    [pointMode],
  );

  const handleTableMouseOver = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (!pointMode || !dragAnchorRef.current) return;
      const cell = cellFromEvent(e);
      if (!cell) return;
      setPointRange({ a: dragAnchorRef.current, b: cell });
    },
    [pointMode],
  );

  const handleTableMouseUp = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      if (!pointMode || !dragAnchorRef.current) return;
      const end = cellFromEvent(e) ?? dragAnchorRef.current;
      onPointRef(rangeRefStr(dragAnchorRef.current, end));
      dragAnchorRef.current = null;
      setPointRange(null);
    },
    [pointMode, onPointRef],
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
    [selectedCell, onSelectCell, onCommitAndMove],
  );

  return (
    <GridContainer
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Spreadsheet grid"
      role="grid"
    >
      <Table role="presentation">
        {/* Column widths */}
        <colgroup>
          <col style={{ width: '52px', minWidth: '52px' }} />
          {Array.from({ length: COLS }, (_, i) => (
            <col key={i} style={{ width: '100px', minWidth: '60px' }} />
          ))}
        </colgroup>

        {/* Column headers — sticky */}
        <thead>
          <tr>
            <CornerTh aria-label="Row / Column" />
            {Array.from({ length: COLS }, (_, col) => (
              <ColTh
                key={col}
                $selected={selectedCell?.col === col}
                aria-label={`Column ${colLetter(col)}`}
              >
                {colLetter(col)}
              </ColTh>
            ))}
          </tr>
        </thead>

        {/* Rows */}
        <tbody
          onClick={handleTableClick}
          onMouseDown={handleTableMouseDown}
          onMouseOver={handleTableMouseOver}
          onMouseUp={handleTableMouseUp}
        >
          {Array.from({ length: ROWS }, (_, row) => (
            <tr key={row}>
              {/* Row number — sticky */}
              <RowTh
                $selected={selectedCell?.row === row}
                aria-label={`Row ${row + 1}`}
              >
                {row + 1}
              </RowTh>

              {/* Data cells */}
              {Array.from({ length: COLS }, (_, col) => {
                const key = `${row}-${col}`;
                const cell = cellMap.get(key);
                const cursor = cursorMap.get(key);
                const isSelected =
                  selectedCell?.row === row && selectedCell?.col === col;

                // Highlight cells inside the range currently being pointed at.
                const inPointRange =
                  pointRange !== null &&
                  row >= Math.min(pointRange.a.row, pointRange.b.row) &&
                  row <= Math.max(pointRange.a.row, pointRange.b.row) &&
                  col >= Math.min(pointRange.a.col, pointRange.b.col) &&
                  col <= Math.max(pointRange.a.col, pointRange.b.col);

                // While editing the selected cell, show the raw in-progress
                // text live; otherwise show the stored computed value.
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
                    $pointHighlight={inPointRange}
                    aria-selected={isSelected}
                    role="gridcell"
                    title={cell ? `${colLetter(col)}${row + 1}: ${cell.raw_value}` : undefined}
                  >
                    <CellValue $isFormula={shownIsFormula}>
                      {shownValue}
                    </CellValue>
                    {/* Cursor label for collaborators */}
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
  /* Extra bottom/right space so the last row/col isn't flush against the edge */
  margin-bottom: 60px;
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
  cursor: default;
  user-select: none;
  transition: background 0.1s, color 0.1s;
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
  cursor: default;
  user-select: none;
  transition: background 0.1s, color 0.1s;
`;

const DataCell = styled.td<{ $selected: boolean; $cursorColor?: string; $pointHighlight?: boolean }>`
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

  /* Selected cell: blue outline (2 px, inset so it doesn't shift layout) */
  ${(p) =>
    p.$selected &&
    `
    outline: 2px solid ${ACCENT};
    outline-offset: -2px;
    background: rgba(59, 130, 246, 0.04);
    z-index: 1;
  `}

  /* Peer cursor: colored border top+left (inset) when not selected */
  ${(p) =>
    p.$cursorColor && !p.$selected &&
    `
    outline: 2px solid ${p.$cursorColor};
    outline-offset: -2px;
    z-index: 1;
  `}

  /* Point-mode: cell is inside the range being dragged into the formula */
  ${(p) =>
    p.$pointHighlight &&
    !p.$selected &&
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
