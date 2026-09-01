import { describe, it, expect } from 'vitest';
import { toTSV, fromTSV } from './clipboard';

describe('toTSV', () => {
  it('joins cells with tabs and rows with newlines', () => {
    expect(toTSV([['1', '2'], ['3', '4']])).toBe('1\t2\n3\t4');
  });
  it('serializes a single cell', () => {
    expect(toTSV([['hi']])).toBe('hi');
  });
});

describe('fromTSV', () => {
  it('parses a TSV grid', () => {
    expect(fromTSV('1\t2\n3\t4')).toEqual([['1', '2'], ['3', '4']]);
  });
  it('strips a single trailing newline (Excel/Sheets append one)', () => {
    expect(fromTSV('1\t2\n')).toEqual([['1', '2']]);
  });
  it('preserves ragged rows', () => {
    expect(fromTSV('1\t2\n3')).toEqual([['1', '2'], ['3']]);
  });
  it('round-trips with toTSV', () => {
    const grid = [['=A1*2', 'x'], ['3', '']];
    expect(fromTSV(toTSV(grid))).toEqual(grid);
  });
});
