import { describe, expect, it } from 'vitest';
import { ago, nsToMs } from './time';

describe('ago', () => {
  const now = Date.UTC(2026, 8, 25, 12);
  it('reads like a person would say it', () => {
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ago(now - 2 * 86_400_000, now)).toBe('2 d ago');
    expect(ago(now - 30 * 86_400_000, now)).toMatch(/2026/);
  });
  it('converts node nanoseconds', () => {
    expect(nsToMs(1_790_337_600_000_000_000)).toBe(1_790_337_600_000);
  });
});
