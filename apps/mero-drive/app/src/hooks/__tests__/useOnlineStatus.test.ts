import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from '../useOnlineStatus';

// Mutable mock of the SDK's isOnline; rerender picks up changes.
// (vitest hoists vi.mock above the imports, so mero-react is mocked before
// useOnlineStatus imports it.)
let online = true;
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ isOnline: online }),
}));

beforeEach(() => {
  online = true;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useOnlineStatus', () => {
  it('starts online', () => {
    const { result } = renderHook(() => useOnlineStatus(1000));
    expect(result.current).toBe(true);
  });

  it('stays green through a brief blip that recovers within the grace window', () => {
    const { result, rerender } = renderHook(() => useOnlineStatus(1000));
    online = false;
    rerender();
    act(() => vi.advanceTimersByTime(500)); // still within grace
    expect(result.current).toBe(true);
    online = true; // recovered
    rerender();
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
  });

  it('goes red after staying offline past the grace window', () => {
    const { result, rerender } = renderHook(() => useOnlineStatus(1000));
    online = false;
    rerender();
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('recovers to green when it comes back after going red', () => {
    const { result, rerender } = renderHook(() => useOnlineStatus(1000));
    online = false;
    rerender();
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
    online = true;
    rerender();
    expect(result.current).toBe(true);
  });
});
