import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { visibleInterval } from './visibleInterval';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('visibleInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('ticks on the wall clock while the tab is visible', () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('skips ticks while hidden and runs once on return', () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    expect(tick).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });
});
