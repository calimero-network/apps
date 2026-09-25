import { describe, expect, it } from 'vitest';
import { isLegacyId, legacyPos, newAxisId, positionBetween, positionOf, positionsBetween } from './axis';

describe('positionBetween', () => {
  it('lands strictly between two legacy rows', () => {
    const [a, b] = [legacyPos(3), legacyPos(4)];
    const p = positionBetween(a, b);
    expect(a < p && p < b).toBe(true);
  });

  it('lands before row 0, and keeps finding room there', () => {
    let hi = legacyPos(0);
    for (let i = 0; i < 50; i++) {
      const p = positionBetween('', hi);
      expect(p < hi).toBe(true);
      hi = p;
    }
  });

  it('always finds room between two close positions', () => {
    let [lo, hi] = [legacyPos(7), legacyPos(8)];
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
    const ps = positionsBetween(legacyPos(1), legacyPos(2), 5);
    expect([...ps].sort()).toEqual(ps);
    expect(ps.every((p) => legacyPos(1) < p && p < legacyPos(2))).toBe(true);
    expect(new Set(ps).size).toBe(5);
  });
});

describe('ids and positions', () => {
  it('tells legacy ids from new ones', () => {
    expect(isLegacyId('0')).toBe(true);
    expect(isLegacyId('12')).toBe(true);
    expect(isLegacyId('012')).toBe(false);
    expect(isLegacyId(newAxisId())).toBe(false);
  });

  it('matches the engine legacy position format', () => {
    expect(legacyPos(0)).toBe('5000000000');
    expect(legacyPos(42)).toBe('5000000042');
  });

  it('reads an entry position, or a legacy id fixed one', () => {
    const entries = [{ id: 'nab', pos: '50000000005', deleted: false }];
    expect(positionOf('nab', entries)).toBe('50000000005');
    expect(positionOf('3', entries)).toBe(legacyPos(3));
    expect(positionOf('nzz', entries)).toBeNull();
  });
});
