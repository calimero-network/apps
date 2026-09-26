import { describe, expect, it } from 'vitest';
import { compareKeys, dataRegion, looksLikeHeader, planSort, sortOrder, type SortCell } from './sort';

/** A grid from rows of raw values; computed = raw unless given as [raw, computed]. */
function grid(rows: (string | [string, string])[][]) {
  return (r: number, c: number): SortCell | null => {
    const v = rows[r]?.[c];
    if (v === undefined || v === '') return null;
    const [raw, computed] = Array.isArray(v) ? v : [v, v];
    return { raw, computed, format: '' };
  };
}

describe('compareKeys', () => {
  it('puts numbers before text and blanks last, both ways', () => {
    const keys = ['b', '', '10', 'A', '2'];
    expect([...keys].sort((a, b) => compareKeys(a, b, true))).toEqual(['2', '10', 'A', 'b', '']);
    expect([...keys].sort((a, b) => compareKeys(a, b, false))).toEqual(['b', 'A', '10', '2', '']);
  });
});

describe('planSort', () => {
  const cells = grid([
    ['Name', 'Score'],
    ['Cy', '7'],
    ['Al', '30'],
    ['Bo', ''],
  ]);
  const rect = { top: 0, left: 0, bottom: 3, right: 1 };

  it('orders rows by the key column below a header, blanks last', () => {
    expect(sortOrder(rect, 1, false, true, cells)).toEqual([2, 1, 3]);
    expect(sortOrder(rect, 0, true, true, cells)).toEqual([2, 3, 1]);
  });

  it('moves whole rows and writes only what changes', () => {
    expect(planSort(rect, 1, false, true, cells)).toEqual([
      { row: 1, col: 0, raw: 'Al', format: '' },
      { row: 1, col: 1, raw: '30', format: '' },
      { row: 2, col: 0, raw: 'Cy', format: '' },
      { row: 2, col: 1, raw: '7', format: '' },
    ]);
  });

  it('shifts a moved formula by the rows it moved', () => {
    const f = grid([['3', ['=A1+10', '13']], ['1', ['=A2*2', '2']]]);
    const writes = planSort({ top: 0, left: 0, bottom: 1, right: 1 }, 0, true, false, f);
    expect(writes).toContainEqual({ row: 0, col: 1, raw: '=A1*2', format: '' });
    expect(writes).toContainEqual({ row: 1, col: 1, raw: '=A2+10', format: '' });
    expect(writes).toContainEqual({ row: 0, col: 0, raw: '1', format: '' });
  });
});

describe('dataRegion and looksLikeHeader', () => {
  const cells = grid([
    ['', '', '', ''],
    ['', 'Name', 'Score', ''],
    ['', 'Al', '3', ''],
    ['', 'Bo', '5', ''],
  ]);
  const filled = (r: number, c: number) => cells(r, c) !== null;

  it('grows from one cell to the block of data around it', () => {
    expect(dataRegion({ row: 2, col: 2 }, 10, 10, filled)).toEqual({ top: 1, left: 1, bottom: 3, right: 2 });
  });

  it('spots a text header over numbers', () => {
    expect(looksLikeHeader({ top: 1, left: 1, bottom: 3, right: 2 }, 2, cells)).toBe(true);
    expect(looksLikeHeader({ top: 2, left: 1, bottom: 3, right: 2 }, 2, cells)).toBe(false);
  });
});
