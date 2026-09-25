import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SseEventData } from '@calimero-network/mero-react';
import { useContextEvents } from '../useContextEvents';

// Capture the handler mero-react's useSubscription would register, so
// the test can drive synthetic SSE events through it.
let lastHandler: ((e: SseEventData) => void) | null = null;
let lastIds: string[] = [];
// The shared stream's `connect` listeners, so a test can reopen it.
const connectHandlers = new Set<() => void>();
const events = {
  on: (_: 'connect', h: () => void) => { connectHandlers.add(h); },
  off: (_: 'connect', h: () => void) => { connectHandlers.delete(h); },
};
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (ids: string[], handler: (e: SseEventData) => void) => {
    lastHandler = handler;
    lastIds = ids;
  },
  useMero: () => ({ mero: { events } }),
}));

function reconnect() {
  for (const h of connectHandlers) h();
}

function fire(contextId: string, type?: string) {
  lastHandler?.({ contextId, type, data: {} } as SseEventData);
}

function fireSync(contextId: string, state: string) {
  lastHandler?.({
    contextId,
    type: 'SyncStatus',
    data: { syncState: { state }, failureCount: 0 },
  });
}

beforeEach(() => {
  lastHandler = null;
  lastIds = [];
  connectHandlers.clear();
});

describe('useContextEvents', () => {
  describe('stream reconnects', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    // A node restart drops the stream; SseClient reopens it and re-subscribes,
    // but what changed in the gap never arrives as an event. The page used to
    // keep its pre-outage state until it was re-mounted.
    it('fires onChange once the stream reopens, after the re-subscribe', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents(['ctx-a'], onChange, { strict: true }));
      reconnect();
      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('coalesces a flapping stream into one onChange', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents(['ctx-a'], onChange));
      reconnect();
      vi.advanceTimersByTime(200);
      reconnect();
      vi.advanceTimersByTime(500);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('does nothing with no contexts to watch', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents([], onChange));
      reconnect();
      vi.advanceTimersByTime(500);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('stops listening on unmount', () => {
      const onChange = vi.fn();
      const { unmount } = renderHook(() => useContextEvents(['ctx-a'], onChange));
      reconnect();
      unmount();
      vi.advanceTimersByTime(500);
      reconnect();
      vi.advanceTimersByTime(500);
      expect(onChange).not.toHaveBeenCalled();
      expect(connectHandlers.size).toBe(0);
    });
  });

  it('default (non-strict): fires onChange for ANY event, regardless of contextId', () => {
    const onChange = vi.fn();
    renderHook(() => useContextEvents(['ctx-a'], onChange));
    fire('some-other-context');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores ephemeral presence, which changes no state', () => {
    const onChange = vi.fn();
    renderHook(() => useContextEvents(['ctx-a'], onChange));
    fire('ctx-a', 'Ephemeral');
    expect(onChange).not.toHaveBeenCalled();
    fire('ctx-a', 'StateMutation');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('strict: fires only for events whose contextId is in the subscribed set', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useContextEvents(['ctx-a', 'ctx-b'], onChange, { strict: true }),
    );

    fire('ctx-a');
    expect(onChange).toHaveBeenCalledTimes(1);

    // An event for a context we did NOT subscribe to (e.g. a docs-box
    // mutation from an open editor) must be ignored under strict mode.
    fire('docs-ctx-zzz');
    expect(onChange).toHaveBeenCalledTimes(1);

    fire('ctx-b');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('still subscribes to the same context ids in strict mode', () => {
    renderHook(() =>
      useContextEvents(['ctx-a', 'ctx-b'], vi.fn(), { strict: true }),
    );
    expect(lastIds).toEqual(['ctx-a', 'ctx-b']);
  });

  it('debounceMs: coalesces a burst into one trailing onChange', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      renderHook(() =>
        useContextEvents(['ctx-a'], onChange, { debounceMs: 400 }),
      );
      // Three events in quick succession.
      fire('ctx-a');
      fire('ctx-a');
      fire('ctx-a');
      expect(onChange).not.toHaveBeenCalled(); // nothing yet — still within window
      vi.advanceTimersByTime(399);
      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledTimes(1); // exactly one fire for the burst
    } finally {
      vi.useRealTimers();
    }
  });

  it('debounceMs with strict: filters first, then debounces allowed events', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      renderHook(() =>
        useContextEvents(['ctx-a'], onChange, { strict: true, debounceMs: 400 }),
      );
      fire('other-ctx'); // filtered out — must not arm the timer
      vi.advanceTimersByTime(400);
      expect(onChange).not.toHaveBeenCalled();
      fire('ctx-a');
      vi.advanceTimersByTime(400);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Each sync run reports `syncing` (or snapshot pages) and then one terminal
  // phase: `idle`, `backingOff` after a failure, or `waitingForPeers`.
  describe('sync runs', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('one run triggers one onChange, on its terminal phase', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents(['ctx-a'], onChange));
      fireSync('ctx-a', 'syncing');
      vi.advanceTimersByTime(1_000);
      expect(onChange).not.toHaveBeenCalled();
      fireSync('ctx-a', 'idle');
      vi.advanceTimersByTime(1_000);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('a failed run still triggers one onChange', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents(['ctx-a'], onChange));
      fireSync('ctx-a', 'syncing');
      fireSync('ctx-a', 'backingOff');
      vi.advanceTimersByTime(1_000);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('snapshot pages trigger nothing', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents(['ctx-a'], onChange));
      fireSync('ctx-a', 'receivingSnapshot');
      fireSync('ctx-a', 'receivingSnapshot');
      vi.advanceTimersByTime(1_000);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('a run with no peers triggers one onChange', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents(['ctx-a'], onChange));
      fireSync('ctx-a', 'waitingForPeers');
      vi.advanceTimersByTime(1_000);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('a mutation right after a run still triggers its own onChange', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents(['ctx-a'], onChange));
      fireSync('ctx-a', 'idle');
      fire('ctx-a');
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('an unparseable SyncStatus event still counts as a change', () => {
      const onChange = vi.fn();
      renderHook(() => useContextEvents(['ctx-a'], onChange));
      fireSync('ctx-a', 'someFuturePhase');
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});
