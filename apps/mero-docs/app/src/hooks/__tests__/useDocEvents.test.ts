import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SseEventData } from '@calimero-apps/cloud';
import { useDocEvents } from '../useDocEvents';

// The handler mero-react's useSubscription would register: it receives the
// events of every context the window subscribes to, not just this one's.
let handler: ((e: SseEventData) => void) | null = null;
vi.mock('@calimero-apps/cloud', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSubscription: (_ids: string[], h: (e: SseEventData) => void) => {
    handler = h;
  },
  useMero: () => ({
    mero: { events: { on: () => undefined, off: () => undefined } },
  }),
}));

const idle = (contextId: string) =>
  handler?.({
    contextId,
    type: 'SyncStatus',
    data: { syncState: { state: 'idle' }, failureCount: 0 },
  } as SseEventData);

describe('useDocEvents', () => {
  beforeEach(() => {
    handler = null;
  });

  it("takes its own docs context's events and none of another context's", () => {
    const onChange = vi.fn();
    renderHook(() => useDocEvents('docs-ctx', onChange));
    idle('registry-ctx');
    idle('other-folder-ctx');
    expect(onChange).not.toHaveBeenCalled();
    handler?.({
      contextId: 'docs-ctx',
      type: 'ExecutionEvent',
      data: {},
    } as SseEventData);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
