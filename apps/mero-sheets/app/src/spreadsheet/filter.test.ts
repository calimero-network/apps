import { describe, expect, it } from 'vitest';
import { columnValues, hiddenRows, withColumn, type FilterView } from './filter';

const data = [
  ['Task', 'Owner', 'Done'],
  ['Plan', 'Ada', 'TRUE'],
  ['Build', 'Bob', 'FALSE'],
  ['Ship', 'ada', ''],
  ['Party', 'Cy', 'TRUE'],
];
const valueAt = (r: number, c: number) => data[r]?.[c] ?? '';
const view: FilterView = { rect: { top: 0, left: 0, bottom: 4, right: 2 }, columns: {} };

describe('hiddenRows', () => {
  it('hides nothing without a filter, and never the header', () => {
    expect(hiddenRows(null, valueAt).size).toBe(0);
    expect(hiddenRows(view, valueAt).size).toBe(0);
    expect(hiddenRows({ ...view, columns: { 0: [] } }, valueAt).has(0)).toBe(false);
  });

  it('hides rows whose value is not shown, without regard to case', () => {
    expect([...hiddenRows({ ...view, columns: { 1: ['Ada'] } }, valueAt)]).toEqual([2, 4]);
  });

  it('hides a row when any filtered column rules it out', () => {
    expect([...hiddenRows({ ...view, columns: { 1: ['Ada'], 2: ['TRUE'] } }, valueAt)]).toEqual([2, 3, 4]);
  });

  it('can show blanks', () => {
    expect([...hiddenRows({ ...view, columns: { 2: [''] } }, valueAt)]).toEqual([1, 2, 4]);
  });
});

describe('columnValues and withColumn', () => {
  it('lists distinct values once each, blanks last', () => {
    expect(columnValues(view, 1, valueAt)).toEqual(['Ada', 'Bob', 'Cy']);
    expect(columnValues(view, 2, valueAt)).toEqual(['FALSE', 'TRUE', '']);
  });

  it('drops a column filter that shows everything', () => {
    const all = columnValues(view, 1, valueAt);
    expect(withColumn(view, 1, ['Ada'], all).columns).toEqual({ 1: ['Ada'] });
    expect(withColumn({ ...view, columns: { 1: ['Ada'] } }, 1, all, all).columns).toEqual({});
  });
});
