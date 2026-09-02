import { describe, it, expect } from 'vitest';
import { planFill, type SourceCell } from './fill';

// Build a getCell from a { "r-c": {raw, format} } map.
function lookup(map: Record<string, SourceCell>) {
  return (r: number, c: number): SourceCell | null => map[`${r}-${c}`] ?? null;
}

describe('planFill', () => {
  it('fills a formula down, shifting relative refs', () => {
    const get = lookup({ '0-0': { raw: '=B1*2', format: '' } });
    const writes = planFill(
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 0, left: 0, bottom: 2, right: 0 },
      get,
    );
    expect(writes).toEqual([
      { row: 1, col: 0, raw: '=B2*2', format: '' },
      { row: 2, col: 0, raw: '=B3*2', format: '' },
    ]);
  });

  it('extends a numeric series down', () => {
    const get = lookup({ '0-0': { raw: '1', format: '' }, '1-0': { raw: '2', format: '' } });
    const writes = planFill(
      { top: 0, left: 0, bottom: 1, right: 0 },
      { top: 0, left: 0, bottom: 3, right: 0 },
      get,
    );
    expect(writes).toEqual([
      { row: 2, col: 0, raw: '3', format: '' },
      { row: 3, col: 0, raw: '4', format: '' },
    ]);
  });

  it('copies a single value and its format down', () => {
    const get = lookup({ '0-0': { raw: '7', format: 'currency' } });
    const writes = planFill(
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 0, left: 0, bottom: 1, right: 0 },
      get,
    );
    expect(writes).toEqual([{ row: 1, col: 0, raw: '7', format: 'currency' }]);
  });

  it('fills a formula right, shifting the column', () => {
    const get = lookup({ '0-0': { raw: '=A2+1', format: '' } });
    const writes = planFill(
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 0, left: 0, bottom: 0, right: 1 },
      get,
    );
    expect(writes).toEqual([{ row: 0, col: 1, raw: '=B2+1', format: '' }]);
  });

  it('returns nothing when target does not extend the source', () => {
    const get = lookup({ '0-0': { raw: '1', format: '' } });
    expect(planFill({ top: 0, left: 0, bottom: 0, right: 0 }, { top: 0, left: 0, bottom: 0, right: 0 }, get)).toEqual([]);
  });
});
