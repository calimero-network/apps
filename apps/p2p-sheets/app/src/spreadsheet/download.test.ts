import { describe, it, expect } from 'vitest';
import { sheetsToCsv } from './download';

describe('sheetsToCsv', () => {
  it('emits a header + quoted grid per sheet, padding gaps', () => {
    const csv = sheetsToCsv([
      {
        name: 'Sheet 1',
        cells: [
          { row: 0, col: 0, computed_value: '1', format: '' },
          { row: 0, col: 1, computed_value: '2', format: '' },
          { row: 1, col: 1, computed_value: 'x', format: '' },
        ],
      },
    ]);
    expect(csv).toBe('# Sheet 1\n"1","2"\n"","x"\n');
  });

  it('escapes embedded double quotes', () => {
    const csv = sheetsToCsv([
      { name: 'S', cells: [{ row: 0, col: 0, computed_value: 'a"b', format: '' }] },
    ]);
    expect(csv).toBe('# S\n"a""b"\n');
  });

  it('emits header + blank line for an empty sheet', () => {
    expect(sheetsToCsv([{ name: 'Empty', cells: [] }])).toBe('# Empty\n');
  });
});
