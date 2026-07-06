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
import React, { memo, useCallback, useMemo, useRef } from 'react';
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
  onSelectCell: (row: number, col: number) => void;
  onCommitAndMove: (direction: 'down' | 'right' | 'none') => void;
}

// ── Component ────────────────────────────────────────────────────────────────

function SpreadsheetGrid({
  sheetId,
  cells,
  cursors,
  selectedCell,
  onSelectCell,
  onCommitAndMove,
}: SpreadsheetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Event delegation: one click handler on the table body
  const handleTableClick = useCallback(
    (e: React.MouseEvent<HTMLTableSectionElement>) => {
      const td = (e.target as Element).closest('td[data-row]') as HTMLElement | null;
      if (!td) return;
      const row = parseInt(td.dataset.row ?? '0', 10);
      const col = parseInt(td.dataset.col ?? '0', 10);
      onSelectCell(row, col);
    },
    [onSelectCell],
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
        <tbody onClick={handleTableClick}>
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

                return (
                  <DataCell
                    key={col}
                    data-row={row}
                    data-col={col}
                    data-testid="item-cell"
                    $selected={isSelected}
                    $cursorColor={cursor?.color}
                    aria-selected={isSelected}
                    role="gridcell"
                    title={cell ? `${colLetter(col)}${row + 1}: ${cell.raw_value}` : undefined}
                  >
                    <CellValue $isFormula={cell?.raw_value.startsWith('=') ?? false}>
                      {cell?.computed_value ?? ''}
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

const DataCell = styled.td<{ $selected: boolean; $cursorColor?: string }>`
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
