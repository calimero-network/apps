import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SseEventData } from '@calimero-network/mero-react';
import { useContextEvents } from '../useContextEvents';

// Capture the handler mero-react's useSubscription would register, so
// the test can drive synthetic SSE events through it.
let lastHandler: ((e: SseEventData) => void) | null = null;
let lastIds: string[] = [];
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (ids: string[], handler: (e: SseEventData) => void) => {
    lastHandler = handler;
    lastIds = ids;
  },
}));

function fire(contextId: string) {
  lastHandler?.({ contextId, data: {} } as SseEventData);
}

beforeEach(() => {
  lastHandler = null;
  lastIds = [];
});

describe('useContextEvents', () => {
  it('default (non-strict): fires onChange for ANY event, regardless of contextId', () => {
    const onChange = vi.fn();
    renderHook(() => useContextEvents(['ctx-a'], onChange));
    fire('some-other-context');
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
});
