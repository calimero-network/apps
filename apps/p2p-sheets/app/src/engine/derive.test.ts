import { describe, it, expect } from 'vitest';
import {
  cellKey, snapshotFromCells, retireOverlay, buildEngineInput,
  deriveActiveCells, diffComputed,
  type Overlay, type OverlayEntry,
} from './derive';
import type { Cell } from '../api/spreadsheet/SpreadsheetClient';

const cell = (sheet: string, row: number, col: number, raw: string, computed = raw, format = ''): Cell => ({
  id: `${sheet}|${row}|${col}`, sheet_id: sheet, row, col,
  raw_value: raw, computed_value: computed, format, updated_at: 0,
});
const ov = (sheet: string, row: number, col: number, raw: string, format = ''): OverlayEntry =>
  ({ sheet_id: sheet, row, col, raw_value: raw, format });

// A stub engine: sums are not needed — echo raw, resolve one cross-sheet case.
const stubEval = (json: string): string => {
  const input = JSON.parse(json) as { cells: { sheet_id: string; row: number; col: number; raw_value: string }[] };
  return JSON.stringify(input.cells.map((c) => ({
    sheet_id: c.sheet_id, row: c.row, col: c.col,
    computed_value: c.raw_value.startsWith('=') ? 'DERIVED' : c.raw_value,
  })));
};

describe('overlay precedence', () => {
  it('overlay value overrides the snapshot in the engine input', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '1')]);
    const overlay: Overlay = new Map([[cellKey('s', 0, 0), ov('s', 0, 0, '9')]]);
    const input = JSON.parse(buildEngineInput(snap, overlay, ['s']));
    const a1 = input.cells.find((c: any) => c.row === 0 && c.col === 0);
    expect(a1.raw_value).toBe('9');
  });
});

describe('retireOverlay', () => {
  it('drops an overlay entry the snapshot now confirms (equal raw)', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '9')]);
    const overlay: Overlay = new Map([[cellKey('s', 0, 0), ov('s', 0, 0, '9')]]);
    const next = retireOverlay(overlay, snap);
    expect(next.has(cellKey('s', 0, 0))).toBe(false);
  });

  it('keeps an in-flight entry the snapshot has not caught up to', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '1')]); // node still shows old value
    const overlay: Overlay = new Map([[cellKey('s', 0, 0), ov('s', 0, 0, '9')]]);
    const next = retireOverlay(overlay, snap);
    expect(next.get(cellKey('s', 0, 0))?.raw_value).toBe('9');
  });

  it('retires a confirmed clear (overlay blank, snapshot absent)', () => {
    const snap = snapshotFromCells([]); // cleared cell gone from node
    const overlay: Overlay = new Map([[cellKey('s', 0, 0), ov('s', 0, 0, '')]]);
    const next = retireOverlay(overlay, snap);
    expect(next.has(cellKey('s', 0, 0))).toBe(false);
  });
});

describe('deriveActiveCells', () => {
  it('returns active-sheet cells with engine-computed values, overlay applied', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '1'), cell('other', 0, 0, '5')]);
    const overlay: Overlay = new Map([[cellKey('s', 1, 0), ov('s', 1, 0, '=X')]]);
    const out = deriveActiveCells(snap, overlay, ['s', 'other'], 's', stubEval);
    // active sheet only
    expect(out.every((c) => c.sheet_id === 's')).toBe(true);
    const a2 = out.find((c) => c.row === 1 && c.col === 0)!;
    expect(a2.computed_value).toBe('DERIVED');
    expect(a2.raw_value).toBe('=X');
  });

  it('hides a fully-blank cleared cell but keeps a formatted-but-empty one', () => {
    const snap = snapshotFromCells([cell('s', 0, 0, '', '', 'bold')]);
    const overlay: Overlay = new Map([[cellKey('s', 1, 0), ov('s', 1, 0, '')]]); // cleared, no format
    const out = deriveActiveCells(snap, overlay, ['s'], 's', stubEval);
    expect(out.some((c) => c.row === 0 && c.col === 0)).toBe(true);  // formatted kept
    expect(out.some((c) => c.row === 1 && c.col === 0)).toBe(false); // blank hidden
  });
});

describe('diffComputed', () => {
  it('reports cells where node and derived computed values disagree', () => {
    const node = [cell('s', 0, 0, '=A', 'NODE')];
    const derived = [cell('s', 0, 0, '=A', 'DERIVED')];
    expect(diffComputed(node, derived)).toEqual([cellKey('s', 0, 0)]);
  });
  it('is empty when they agree', () => {
    const node = [cell('s', 0, 0, '=A', 'X')];
    const derived = [cell('s', 0, 0, '=A', 'X')];
    expect(diffComputed(node, derived)).toEqual([]);
  });
  it('reports a node cell missing from derived (dropped out of derivation)', () => {
    const node = [cell('s', 0, 0, '=A', 'NODE')];
    const derived: Cell[] = [];
    expect(diffComputed(node, derived)).toEqual([cellKey('s', 0, 0)]);
  });
});
