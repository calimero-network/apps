import { describe, it, expect } from 'vitest';
import { openedLabel, updatedLabel } from '../relativeTime';

const MIN = 60_000;
const HOUR = 60 * MIN;
// A fixed local afternoon, so "today" and "yesterday" never straddle midnight.
const NOW = new Date(2026, 8, 28, 15, 30).getTime();

describe('updatedLabel', () => {
  it('says just now for the last minute, and for a clock that runs ahead', () => {
    expect(updatedLabel(NOW - 30_000, NOW)).toBe('Just now');
    expect(updatedLabel(NOW + 5 * MIN, NOW)).toBe('Just now');
  });

  it('counts minutes, then hours within today', () => {
    expect(updatedLabel(NOW - 2 * MIN, NOW)).toBe('2 min ago');
    expect(updatedLabel(NOW - 59 * MIN, NOW)).toBe('59 min ago');
    expect(updatedLabel(NOW - HOUR, NOW)).toBe('1 h ago');
    expect(updatedLabel(new Date(2026, 8, 28, 0, 5).getTime(), NOW)).toBe(
      '15 h ago',
    );
  });

  it('says yesterday for any time on the day before', () => {
    expect(updatedLabel(new Date(2026, 8, 27, 23, 59).getTime(), NOW)).toBe(
      'Yesterday',
    );
    expect(updatedLabel(new Date(2026, 8, 27, 0, 0).getTime(), NOW)).toBe(
      'Yesterday',
    );
  });

  it('shows a date before that, with the year only when it differs', () => {
    const sep22 = new Date(2026, 8, 22, 10).getTime();
    const lastYear = new Date(2025, 11, 31, 10).getTime();
    const day = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const dayYear = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    expect(updatedLabel(sep22, NOW)).toBe(day.format(sep22));
    expect(updatedLabel(lastYear, NOW)).toBe(dayYear.format(lastYear));
  });
});

describe('openedLabel', () => {
  it('reads as part of a sentence', () => {
    expect(openedLabel(NOW - 30_000, NOW)).toBe('opened just now');
    expect(openedLabel(NOW - 4 * MIN, NOW)).toBe('opened 4 min ago');
    expect(openedLabel(NOW - HOUR, NOW)).toBe('opened 1 h ago');
    expect(openedLabel(new Date(2026, 8, 27, 9).getTime(), NOW)).toBe(
      'opened yesterday',
    );
    const sep22 = new Date(2026, 8, 22, 9).getTime();
    expect(openedLabel(sep22, NOW)).toBe(`opened ${updatedLabel(sep22, NOW)}`);
  });
});
