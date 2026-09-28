import { describe, expect, it } from 'vitest';
import { nsToMs, rowKey } from '../types';

describe('workspace index types', () => {
  it('keys a row by folder and doc', () => {
    expect(rowKey('f1', 'd1')).toBe('f1/d1');
  });

  it('converts node nanoseconds to whole milliseconds', () => {
    expect(nsToMs(1_700_000_000_123_456_789)).toBe(1_700_000_000_123);
    expect(nsToMs(999_999)).toBe(0);
    expect(nsToMs(0)).toBe(0);
  });
});
