import { describe, expect, it } from 'vitest';
import { isImplicitId, implicitPos, newAxisId, positionBetween, positionOf, positionsBetween } from './axis';

describe('positionBetween', () => {
  it('lands strictly between two implicit rows', () => {
    const [a, b] = [implicitPos(3), implicitPos(4)];
    const p = positionBetween(a, b);
    expect(a < p && p < b).toBe(true);
  });

  it('lands before row 0, and keeps finding room there', () => {
    let hi = implicitPos(0);
    for (let i = 0; i < 50; i++) {
      const p = positionBetween('', hi);
      expect(p < hi).toBe(true);
      hi = p;
    }
  });

  it('always finds room between two close positions', () => {
    let [lo, hi] = [implicitPos(7), implicitPos(8)];
    for (let i = 0; i < 200; i++) {
      const p = positionBetween(lo, hi);
      expect(lo < p && p < hi).toBe(true);
      if (i % 2) lo = p; else hi = p;
    }
  });

  it('refuses a pair with nothing between rather than looping', () => {
    expect(() => positionBetween('5', '50')).toThrow();
  });

  it('works with no upper bound', () => {
    const p = positionBetween('59', null);
    expect(p > '59').toBe(true);
  });
});

describe('positionsBetween', () => {
  it('gives increasing positions inside the gap', () => {
    const ps = positionsBetween(implicitPos(1), implicitPos(2), 5);
    expect([...ps].sort()).toEqual(ps);
    expect(ps.every((p) => implicitPos(1) < p && p < implicitPos(2))).toBe(true);
    expect(new Set(ps).size).toBe(5);
  });
});

describe('ids and positions', () => {
  it('tells implicit ids from new ones', () => {
    expect(isImplicitId('0')).toBe(true);
    expect(isImplicitId('12')).toBe(true);
    expect(isImplicitId('012')).toBe(false);
    expect(isImplicitId(newAxisId())).toBe(false);
  });

  it('matches the engine implicit position format', () => {
    expect(implicitPos(0)).toBe('5000000000');
    expect(implicitPos(42)).toBe('5000000042');
  });

  it('reads an entry position, or an implicit id fixed one', () => {
    const entries = [{ id: 'nab', pos: '50000000005', deleted: false }];
    expect(positionOf('nab', entries)).toBe('50000000005');
    expect(positionOf('3', entries)).toBe(implicitPos(3));
    expect(positionOf('nzz', entries)).toBeNull();
  });
});
