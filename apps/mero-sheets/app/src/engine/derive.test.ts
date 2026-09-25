import { describe, it, expect } from 'vitest';
import {
  cellKey, snapshotFromCells, retireOverlay, buildEngineInput,
  deriveSheetCells, diffComputed,
  type GridCell, type Overlay, type OverlayEntry, type Placement,
} from './derive';
import type { Cell } from '../api/spreadsheet/SpreadsheetClient';

const cell = (sheet: string, row: string, col: string, raw: string, computed = raw, format = ''): Cell => ({
  id: `${sheet}|${row}|${col}`, sheet_id: sheet, row_id: row, col_id: col,
  raw_value: raw, computed_value: computed, format, updated_at: 0,
});
const ov = (sheet: string, row: string, col: string, raw: string, format = ''): OverlayEntry =>
  ({ sheet_id: sheet, row_id: row, col_id: col, raw_value: raw, format });
const grid = (c: Cell, row: number, col: number): GridCell => ({ ...c, row, col });

// A stub engine: echo literals, mark formulas as derived.
const stubEval = (json: string): string => {
  const input = JSON.parse(json) as { cells: { sheet_id: string; row_id: string; col_id: string; raw_value: string }[] };
  return JSON.stringify(input.cells.map((c) => ({
    sheet_id: c.sheet_id, row_id: c.row_id, col_id: c.col_id,
    computed_value: c.raw_value.startsWith('=') ? 'DERIVED' : c.raw_value,
  })));
};

// The legacy layout, plus a new row `nab` placed second.
const place: Placement = {
  order: { rows: ['0', 'nab', '1', '2'], cols: ['0', '1'] },
  toDisplay: (stored) => stored.replace('{r=nab;c=0}', 'A2'),
};

describe('overlay precedence', () => {
  it('overlay value overrides the snapshot in the engine input', () => {
    const snap = snapshotFromCells([cell('s', '0', '0', '1')]);
    const overlay: Overlay = new Map([[cellKey('s', '0', '0'), ov('s', '0', '0', '9')]]);
    const input = JSON.parse(buildEngineInput(snap, overlay, ['s'])) as { cells: { row_id: string; raw_value: string }[] };
    expect(input.cells.find((c) => c.row_id === '0')?.raw_value).toBe('9');
  });
  it('passes the clock so NOW()/TODAY() evaluate', () => {
    const input = JSON.parse(buildEngineInput(new Map(), new Map(), ['s'], 1234));
    expect(input.now_ms).toBe(1234);
  });
});

describe('retireOverlay', () => {
  it('drops an overlay entry the snapshot now confirms (equal raw)', () => {
    const snap = snapshotFromCells([cell('s', '0', '0', '9')]);
    const overlay: Overlay = new Map([[cellKey('s', '0', '0'), ov('s', '0', '0', '9')]]);
    expect(retireOverlay(overlay, snap).has(cellKey('s', '0', '0'))).toBe(false);
  });

  it('keeps an in-flight entry the snapshot has not caught up to', () => {
    const snap = snapshotFromCells([cell('s', '0', '0', '1')]); // node still shows old value
    const overlay: Overlay = new Map([[cellKey('s', '0', '0'), ov('s', '0', '0', '9')]]);
    expect(retireOverlay(overlay, snap).get(cellKey('s', '0', '0'))?.raw_value).toBe('9');
  });

  it('retires a confirmed clear (overlay blank, snapshot absent)', () => {
    const overlay: Overlay = new Map([[cellKey('s', '0', '0'), ov('s', '0', '0', '')]]);
    expect(retireOverlay(overlay, snapshotFromCells([])).has(cellKey('s', '0', '0'))).toBe(false);
  });
});

describe('deriveSheetCells', () => {
  it('places cells by the sheet order and shows formulas in display form', () => {
    const snap = snapshotFromCells([
      cell('s', '0', '0', '1'),
      cell('s', '1', '0', '=A1'),
      cell('other', '0', '0', '5'),
    ]);
    const overlay: Overlay = new Map([[cellKey('s', 'nab', '1'), ov('s', 'nab', '1', '={r=nab;c=0}*2')]]);
    const out = deriveSheetCells(snap, overlay, ['s', 'other'], 's', stubEval, place);
    expect(out.every((c) => c.sheet_id === 's')).toBe(true);
    // Legacy row 1 sits third, after the inserted row.
    expect(out.find((c) => c.row_id === '1')).toMatchObject({ row: 2, col: 0, computed_value: 'DERIVED' });
    expect(out.find((c) => c.row_id === 'nab')).toMatchObject({ row: 1, col: 1, raw_value: '=A2*2' });
  });

  it('does not place a cell whose row is not in the order (deleted)', () => {
    const snap = snapshotFromCells([cell('s', '7', '0', 'x')]);
    expect(deriveSheetCells(snap, new Map(), ['s'], 's', stubEval, place)).toEqual([]);
  });

  it('hides a fully-blank cleared cell but keeps a formatted-but-empty one', () => {
    const snap = snapshotFromCells([cell('s', '0', '0', '', '', 'bold')]);
    const overlay: Overlay = new Map([[cellKey('s', '1', '0'), ov('s', '1', '0', '')]]); // cleared, no format
    const out = deriveSheetCells(snap, overlay, ['s'], 's', stubEval, place);
    expect(out.some((c) => c.row_id === '0')).toBe(true);  // formatted kept
    expect(out.some((c) => c.row_id === '1')).toBe(false); // blank hidden
  });
});

describe('diffComputed', () => {
  it('reports cells where node and derived computed values disagree', () => {
    const node = [cell('s', '0', '0', '=A', 'NODE')];
    expect(diffComputed(node, [grid(cell('s', '0', '0', '=A', 'DERIVED'), 0, 0)], place.order)).toEqual([cellKey('s', '0', '0')]);
  });
  it('is empty when they agree', () => {
    const node = [cell('s', '0', '0', '=A', 'X')];
    expect(diffComputed(node, [grid(cell('s', '0', '0', '=A', 'X'), 0, 0)], place.order)).toEqual([]);
  });
  it('ignores NOW()/TODAY() cells, which read each side\'s own clock', () => {
    const node = [cell('s', '0', '0', '=NOW()', '46290.5')];
    expect(diffComputed(node, [grid(cell('s', '0', '0', '=NOW()', '46290.6'), 0, 0)], place.order)).toEqual([]);
  });
  it('skips a stored cell in a deleted row, which is never placed', () => {
    expect(diffComputed([cell('s', '7', '0', '=A', 'NODE')], [], place.order)).toEqual([]);
  });
  it('reports a node cell missing from derived (dropped out of derivation)', () => {
    expect(diffComputed([cell('s', '0', '0', '=A', 'NODE')], [], place.order)).toEqual([cellKey('s', '0', '0')]);
  });
});
