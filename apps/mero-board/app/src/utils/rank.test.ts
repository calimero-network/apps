import { describe, expect, it } from 'vitest';
import { rankAfter, rankBetween, rankFor } from './rank';

describe('rank', () => {
  it('starts at the middle digit and appends increasing ranks', () => {
    expect(rankAfter(null)).toBe('i');
    let last: string | null = null;
    for (let i = 0; i < 200; i++) {
      const next = rankAfter(last);
      expect(/^[0-9a-z]+$/.test(next)).toBe(true);
      expect(next.endsWith('0')).toBe(false);
      if (last) expect(next > last).toBe(true);
      last = next;
    }
  });

  it('between stays strictly inside the neighbours', () => {
    let lo = 'i';
    const hi = 'r';
    for (let i = 0; i < 200; i++) {
      const mid = rankBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      lo = mid;
    }
  });

  it('prepends before the first', () => {
    let hi = 'i';
    for (let i = 0; i < 200; i++) {
      const before = rankBetween(null, hi);
      expect(before < hi).toBe(true);
      hi = before;
    }
  });

  it('matches the contract on the first few appends', () => {
    expect(rankAfter('i')).toBe('r');
    expect(rankAfter('r')).toBe('w');
    expect(rankBetween('i', 'r')).toBe('n');
  });

  it('rankFor places at an index among sorted siblings', () => {
    const sibs = [{ rank: 'i' }, { rank: 'r' }, { rank: 'v' }];
    expect(rankFor(sibs, 0) < 'i').toBe(true);
    const mid = rankFor(sibs, 1);
    expect('i' < mid && mid < 'r').toBe(true);
    expect(rankFor(sibs, 3) > 'v').toBe(true);
    expect(rankFor([], 0)).toBe('i');
  });
});
