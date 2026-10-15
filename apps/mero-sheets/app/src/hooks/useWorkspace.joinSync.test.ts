// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { isNamespaceJustJoined, markNamespaceJustJoined } from '@calimero-network/mero-react';
import { useWorkspace } from './useWorkspace';

const NS = 'ns-joined';

// What the joiner's node holds for the namespace. Starts empty: right after a
// join the node has not synced the workspace's contexts yet.
let nodeContexts: { contextId: string; name: string }[] = [];

// A read that is in flight for one render and then answers with whatever the
// node holds at that moment — the shape of mero-react's resource hooks.
function useFakeRead<T>(read: () => T) {
  const [state, setState] = useState(() => ({ data: read(), loading: true }));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => setState({ data: read(), loading: false }), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const refetch = async () => setTick((t) => t + 1);
  return { ...state, refetch };
}

// Stable across renders, like the real provider's client.
const mero = { admin: {} };

vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@calimero-network/mero-react')>()),
  useMero: () => ({ mero, contextId: null, contextIdentity: null }),
  useNamespacesForApplication: () => {
    const { data, loading, refetch } = useFakeRead(() => [{ namespaceId: NS, name: 'Team' }]);
    return { namespaces: data, loading, refetch };
  },
  useGroupContexts: () => {
    const { data, loading, refetch } = useFakeRead(() => nodeContexts);
    return { contexts: data, loading, refetch };
  },
}));

vi.mock('./useApplicationId', () => ({
  useApplicationId: () => ({ appId: 'app-1', resolving: false, notInstalled: false }),
}));

describe('useWorkspace right after joining a workspace', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.clear();
    nodeContexts = [];
    markNamespaceJustJoined(NS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The joiner's first read comes back empty because the node has not synced
  // yet. That must not settle the gate (closing the invitation dialog and
  // showing an empty picker); the list is re-read until the spreadsheet lands.
  it('keeps re-reading an empty list until the spreadsheets arrive', async () => {
    const { result } = renderHook(() => useWorkspace());
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.workspaces).toEqual([]);
    expect(result.current.isSyncing).toBe(true);
    expect(isNamespaceJustJoined(NS)).toBe(true);

    nodeContexts = [{ contextId: 'ctx-1', name: 'Q3 Budget' }];
    await act(() => vi.advanceTimersByTimeAsync(2_500));

    await waitFor(() => expect(result.current.workspaces.map((w) => w.name)).toEqual(['Q3 Budget']));
    expect(result.current.isSyncing).toBe(false);
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  // A workspace that really is empty still settles — once the watchdog gives up.
  it('settles a genuinely empty workspace once the gate expires', async () => {
    const { result } = renderHook(() => useWorkspace());
    await act(() => vi.advanceTimersByTimeAsync(125_000));
    expect(result.current.workspaces).toEqual([]);
    expect(result.current.isSyncing).toBe(false);
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });
});
