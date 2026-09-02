import { describe, it, expect } from 'vitest';
import { fillSeries } from './series';

describe('fillSeries', () => {
  it('copies a single value verbatim (numbers do not increment)', () => {
    expect(fillSeries(['5'], 3)).toEqual(['5', '5', '5']);
    expect(fillSeries(['hi'], 2)).toEqual(['hi', 'hi']);
  });

  it('extends an ascending arithmetic sequence', () => {
    expect(fillSeries(['1', '2'], 3)).toEqual(['3', '4', '5']);
    expect(fillSeries(['5', '10'], 2)).toEqual(['15', '20']);
  });

  it('extends a descending / non-unit step sequence', () => {
    expect(fillSeries(['10', '8'], 2)).toEqual(['6', '4']);
    expect(fillSeries(['0', '0.5'], 2)).toEqual(['1', '1.5']);
  });

  it('repeats cyclically when values are non-numeric or have no constant step', () => {
    expect(fillSeries(['a', 'b'], 3)).toEqual(['a', 'b', 'a']);
    expect(fillSeries(['1', '2', '4'], 2)).toEqual(['1', '2']); // 1,2,4 not constant → cycle
  });

  it('returns empty for a non-positive count', () => {
    expect(fillSeries(['1', '2'], 0)).toEqual([]);
  });
});
