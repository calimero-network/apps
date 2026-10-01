import { describe, expect, it } from 'vitest';
import { chartModel, formatTick, niceTicks } from './chart';

const data = [
  ['Month', 'Sales', 'Costs'],
  ['Jan', '10', '4'],
  ['Feb', '15', 'n/a'],
  ['Mar', '12', '6'],
];
const valueAt = (r: number, c: number) => data[r]?.[c] ?? '';
const col = (c: number) => `Column ${String.fromCharCode(65 + c)}`;

describe('chartModel', () => {
  it('labels by the first column and names series by a text header', () => {
    expect(chartModel({ top: 0, left: 0, bottom: 3, right: 2 }, valueAt, col)).toEqual({
      labels: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'Sales', values: [10, 15, 12] },
        { name: 'Costs', values: [4, null, 6] },
      ],
      dropped: 0,
    });
  });

  it('names series by column without a header, and charts one column by row number', () => {
    const noHeader = chartModel({ top: 1, left: 0, bottom: 3, right: 1 }, valueAt, col);
    expect(noHeader.series[0].name).toBe('Column B');
    expect(noHeader.labels).toEqual(['Jan', 'Feb', 'Mar']);
    const one = chartModel({ top: 1, left: 1, bottom: 3, right: 1 }, valueAt, col);
    expect(one).toMatchObject({ labels: ['2', '3', '4'], series: [{ name: 'Column B', values: [10, 15, 12] }] });
  });

  it('keeps at most eight series', () => {
    const wide = (r: number, c: number) => (r === 0 ? `S${c}` : String(c));
    const m = chartModel({ top: 0, left: 0, bottom: 2, right: 10 }, wide, col);
    expect(m.series).toHaveLength(8);
    expect(m.dropped).toBe(2);
  });
});

describe('ticks', () => {
  it('picks round steps from zero', () => {
    expect(niceTicks(0, 15)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(3, 97)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-4, 6)).toEqual([-4, -2, 0, 2, 4, 6]);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });
  it('formats with separators, compact past a million', () => {
    expect(formatTick(12500)).toBe('12,500');
    expect(formatTick(2500000)).toBe('2.5M');
  });
});
