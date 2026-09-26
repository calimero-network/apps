import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettledSaveStatus } from '../useSettledSaveStatus';
import type { SaveStatus } from '../types';

function setup() {
  return renderHook(({ s }: { s: SaveStatus }) => useSettledSaveStatus(s), {
    initialProps: { s: 'saved' },
  });
}

describe('useSettledSaveStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays on Saved through a quick save', () => {
    const { result, rerender } = setup();
    rerender({ s: 'unsaved' });
    rerender({ s: 'saving' });
    act(() => vi.advanceTimersByTime(300));
    rerender({ s: 'saved' });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe('saved');
  });

  it('shows Saving only once a save runs long', () => {
    const { result, rerender } = setup();
    rerender({ s: 'saving' });
    act(() => vi.advanceTimersByTime(699));
    expect(result.current).toBe('saved');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('saving');
  });

  it('keeps Saving visible long enough to read', () => {
    const { result, rerender } = setup();
    rerender({ s: 'saving' });
    act(() => vi.advanceTimersByTime(700));
    rerender({ s: 'saved' });
    act(() => vi.advanceTimersByTime(499));
    expect(result.current).toBe('saving');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('saved');
  });

  it.each(['error', 'offline'] as const)('shows %s immediately', (s) => {
    const { result, rerender } = setup();
    rerender({ s: 'saving' });
    act(() => vi.advanceTimersByTime(700));
    rerender({ s });
    expect(result.current).toBe(s);
  });
});
