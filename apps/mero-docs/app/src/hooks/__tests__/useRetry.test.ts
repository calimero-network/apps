import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRetry } from '../useRetry';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('useRetry', () => {
  it('doubles the delay per attempt up to ten seconds', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useRetry(run));
    const fired: number[] = [];
    for (const delay of [1000, 2000, 4000, 8000, 10_000, 10_000]) {
      act(() => result.current.schedule());
      advance(delay - 1);
      fired.push(run.mock.calls.length);
      advance(1);
    }
    expect(fired).toEqual([0, 1, 2, 3, 4, 5]);
    expect(run).toHaveBeenCalledTimes(6);
  });

  it('keeps one pending attempt however often it is scheduled', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useRetry(run));
    act(() => {
      result.current.schedule();
      result.current.schedule();
    });
    advance(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reset cancels the pending attempt and starts the backoff over', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useRetry(run));
    act(() => result.current.schedule());
    advance(1000);
    act(() => result.current.schedule());
    act(() => result.current.reset());
    advance(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    act(() => result.current.schedule());
    advance(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs the latest callback and nothing after unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ run }) => useRetry(run),
      { initialProps: { run: first } },
    );
    act(() => result.current.schedule());
    rerender({ run: second });
    advance(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    act(() => result.current.schedule());
    unmount();
    advance(10_000);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
