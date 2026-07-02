import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { SseEventData } from '@calimero-network/mero-react';
import {
  parseSyncStatusEvent,
  useSyncStatus,
  type SyncSnapshot,
} from '../useSyncStatus';

// Capture the handler mero-react's useSubscription registers, so the test
// can drive synthetic SSE events through it.
let lastHandler: ((e: SseEventData) => void) | null = null;
let lastIds: string[] = [];
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (ids: string[], handler: (e: SseEventData) => void) => {
    lastHandler = handler;
    lastIds = ids;
  },
}));

beforeEach(() => {
  lastHandler = null;
  lastIds = [];
});

// Wire shapes exactly as core serializes them (events.rs camelCase +
// sync_status.rs `tag = "state"` camelCase).
const waitingForPeers = (ctx = 'ctx-a'): SseEventData =>
  ({
    contextId: ctx,
    type: 'SyncStatus',
    data: { syncState: { state: 'waitingForPeers' }, failureCount: 2 },
  }) as SseEventData;

const receivingSnapshot = (ctx = 'ctx-a'): SseEventData =>
  ({
    contextId: ctx,
    type: 'SyncStatus',
    data: {
      syncState: {
        state: 'receivingSnapshot',
        recordsReceived: 1200,
        percent: 60,
        etaSecs: 4,
      },
      failureCount: 0,
    },
  }) as SseEventData;

const backingOff = (ctx = 'ctx-a'): SseEventData =>
  ({
    contextId: ctx,
    type: 'SyncStatus',
    data: {
      syncState: { state: 'backingOff', retryInSecs: 8 },
      failureCount: 3,
      lastError: 'connection reset',
    },
  }) as SseEventData;

describe('parseSyncStatusEvent', () => {
  it('parses waitingForPeers', () => {
    expect(parseSyncStatusEvent(waitingForPeers())).toMatchObject<
      Partial<SyncSnapshot>
    >({ contextId: 'ctx-a', phase: 'waitingForPeers', failureCount: 2 });
  });

  it('parses receivingSnapshot with percent + eta + records', () => {
    expect(parseSyncStatusEvent(receivingSnapshot())).toMatchObject<
      Partial<SyncSnapshot>
    >({
      phase: 'receivingSnapshot',
      percent: 60,
      etaSecs: 4,
      recordsReceived: 1200,
    });
  });

  it('parses backingOff with retryInSecs + lastError', () => {
    expect(parseSyncStatusEvent(backingOff())).toMatchObject<
      Partial<SyncSnapshot>
    >({ phase: 'backingOff', retryInSecs: 8, lastError: 'connection reset' });
  });

  it('defaults optional numeric fields to null and failureCount to 0', () => {
    const snap = parseSyncStatusEvent({
      contextId: 'c',
      type: 'SyncStatus',
      data: { syncState: { state: 'syncing' } },
    } as SseEventData);
    expect(snap).toEqual<SyncSnapshot>({
      contextId: 'c',
      phase: 'syncing',
      percent: null,
      etaSecs: null,
      recordsReceived: null,
      retryInSecs: null,
      failureCount: 0,
      lastError: null,
    });
  });

  it('returns null for non-SyncStatus events (e.g. StateMutation, AppVersionChanged)', () => {
    expect(
      parseSyncStatusEvent({ contextId: 'c', data: {} } as SseEventData),
    ).toBeNull();
    expect(
      parseSyncStatusEvent({
        contextId: 'c',
        type: 'AppVersionChanged',
        data: { toVersion: '9.4.0' },
      } as SseEventData),
    ).toBeNull();
  });

  it('returns null for an unknown / malformed sync state', () => {
    expect(
      parseSyncStatusEvent({
        contextId: 'c',
        type: 'SyncStatus',
        data: { syncState: { state: 'teleporting' } },
      } as SseEventData),
    ).toBeNull();
    expect(
      parseSyncStatusEvent({
        contextId: 'c',
        type: 'SyncStatus',
        data: {},
      } as SseEventData),
    ).toBeNull();
  });

  it('coerces non-finite/non-number wire numerics to null (no NaN% in the UI)', () => {
    const snap = parseSyncStatusEvent({
      contextId: 'c',
      type: 'SyncStatus',
      data: {
        syncState: { state: 'receivingSnapshot', percent: 'lots', etaSecs: null },
        failureCount: 'nope',
      },
    } as unknown as SseEventData);
    expect(snap).toMatchObject({ phase: 'receivingSnapshot', percent: null });
    expect(snap?.failureCount).toBe(0);
  });
});

describe('useSyncStatus', () => {
  it('subscribes to the given ids and returns the latest snapshot for them', () => {
    const { result } = renderHook(() => useSyncStatus(['ctx-a', 'ctx-b']));
    expect(lastIds).toEqual(['ctx-a', 'ctx-b']);
    expect(result.current).toBeNull();

    act(() => lastHandler?.(waitingForPeers('ctx-a')));
    expect(result.current?.phase).toBe('waitingForPeers');

    act(() => lastHandler?.(receivingSnapshot('ctx-b')));
    expect(result.current).toMatchObject({
      contextId: 'ctx-b',
      phase: 'receivingSnapshot',
      percent: 60,
    });
  });

  it('normalizes (sorts) the subscribed id set so the SSE key is stable', () => {
    renderHook(() => useSyncStatus(['ctx-b', 'ctx-a']));
    expect(lastIds).toEqual(['ctx-a', 'ctx-b']);
  });

  it('ignores SyncStatus events for contexts it did not subscribe to', () => {
    const { result } = renderHook(() => useSyncStatus('ctx-a'));
    act(() => lastHandler?.(receivingSnapshot('some-other-ctx')));
    expect(result.current).toBeNull();
  });

  it('resets the snapshot to null when the subscribed id set changes', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useSyncStatus(ids),
      { initialProps: { ids: ['ctx-a'] as string[] } },
    );
    act(() => lastHandler?.(waitingForPeers('ctx-a')));
    expect(result.current?.phase).toBe('waitingForPeers');

    // Switch namespaces → new id set → stale snapshot must clear.
    rerender({ ids: ['ctx-b'] });
    expect(result.current).toBeNull();
  });
});
