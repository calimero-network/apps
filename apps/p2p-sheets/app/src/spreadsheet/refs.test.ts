import { describe, it, expect } from 'vitest';
import {
  columnLabel,
  cellRef,
  rangeRef,
  columnRef,
  rowRef,
  normalizeRect,
  sheetPrefix,
} from './refs';

describe('columnLabel', () => {
  it('maps 0-based column index to spreadsheet letters', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
  });

  it('rolls over past Z into two letters', () => {
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(27)).toBe('AB');
    expect(columnLabel(51)).toBe('AZ');
    expect(columnLabel(52)).toBe('BA');
  });
});

describe('cellRef', () => {
  it('renders A1-style reference from 0-based row/col', () => {
    expect(cellRef(0, 0)).toBe('A1');
    expect(cellRef(2, 1)).toBe('B3');
  });
});

describe('rangeRef', () => {
  it('collapses to a single cell reference when both ends are equal', () => {
    expect(rangeRef({ row: 2, col: 1 }, { row: 2, col: 1 })).toBe('B3');
  });

  it('normalizes so top-left comes first regardless of drag direction', () => {
    expect(rangeRef({ row: 2, col: 2 }, { row: 0, col: 0 })).toBe('A1:C3');
    expect(rangeRef({ row: 0, col: 0 }, { row: 2, col: 2 })).toBe('A1:C3');
  });
});

describe('columnRef / rowRef', () => {
  it('renders whole-column reference', () => {
    expect(columnRef(0)).toBe('A:A');
    expect(columnRef(2)).toBe('C:C');
  });

  it('renders whole-row reference (1-based)', () => {
    expect(rowRef(0)).toBe('1:1');
    expect(rowRef(4)).toBe('5:5');
  });
});

describe('sheetPrefix', () => {
  it('leaves simple identifier names unquoted', () => {
    expect(sheetPrefix('Data')).toBe('Data!');
    expect(sheetPrefix('Sheet2')).toBe('Sheet2!');
  });

  it('quotes names with spaces or special characters', () => {
    expect(sheetPrefix('Sheet 1')).toBe("'Sheet 1'!");
    expect(sheetPrefix('Q3 Budget')).toBe("'Q3 Budget'!");
  });

  it('escapes single quotes inside a name by doubling them', () => {
    expect(sheetPrefix("Bob's data")).toBe("'Bob''s data'!");
  });
});

describe('normalizeRect', () => {
  it('returns the inclusive bounding rectangle of two corners', () => {
    expect(normalizeRect({ row: 3, col: 2 }, { row: 1, col: 5 })).toEqual({
      top: 1,
      left: 2,
      bottom: 3,
      right: 5,
    });
  });
});
