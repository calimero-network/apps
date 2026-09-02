import { describe, it, expect } from 'vitest';
import { resolvePoint } from './pointing';

// resolvePoint decides what a grid interaction means given whether we're
// currently editing a formula. This is the logic that was buggy: a click while
// editing a formula must produce a reference to INSERT, not a selection to move.

describe('resolvePoint — not editing a formula', () => {
  it('a cell click selects that cell', () => {
    expect(resolvePoint({ pointMode: false, target: { kind: 'cell', a: { row: 2, col: 1 } } }))
      .toEqual({ action: 'select-cell', row: 2, col: 1 });
  });

  it('a cell drag selects a range', () => {
    expect(resolvePoint({
      pointMode: false,
      target: { kind: 'cell', a: { row: 0, col: 0 }, b: { row: 2, col: 3 } },
    })).toEqual({ action: 'select-range', a: { row: 0, col: 0 }, b: { row: 2, col: 3 } });
  });

  it('a column header selects the whole column', () => {
    expect(resolvePoint({ pointMode: false, target: { kind: 'column', col: 4 } }))
      .toEqual({ action: 'select-column', col: 4 });
  });

  it('a row header selects the whole row', () => {
    expect(resolvePoint({ pointMode: false, target: { kind: 'row', row: 3 } }))
      .toEqual({ action: 'select-row', row: 3 });
  });
});

describe('resolvePoint — editing a formula (point mode)', () => {
  it('a cell click inserts that cell reference', () => {
    expect(resolvePoint({ pointMode: true, target: { kind: 'cell', a: { row: 0, col: 0 } } }))
      .toEqual({ action: 'insert-ref', ref: 'A1' });
  });

  it('a cell drag inserts a range reference', () => {
    expect(resolvePoint({
      pointMode: true,
      target: { kind: 'cell', a: { row: 0, col: 0 }, b: { row: 2, col: 1 } },
    })).toEqual({ action: 'insert-ref', ref: 'A1:B3' });
  });

  it('a column header inserts a whole-column reference', () => {
    expect(resolvePoint({ pointMode: true, target: { kind: 'column', col: 2 } }))
      .toEqual({ action: 'insert-ref', ref: 'C:C' });
  });

  it('a row header inserts a whole-row reference', () => {
    expect(resolvePoint({ pointMode: true, target: { kind: 'row', row: 4 } }))
      .toEqual({ action: 'insert-ref', ref: '5:5' });
  });
});
