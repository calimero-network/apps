// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { isNamespaceJustJoined, markNamespaceJustJoined } from '@calimero-network/mero-react';
import { useWorkspace } from './useWorkspace';

const NS = 'ns-joined';

// What the joiner's node holds for the namespace. Starts empty: right after a
// join the node has not synced the workspace's contexts yet.
let nodeContexts: { contextId: string; name: string }[] = [];
// The namespaces the node lists for this app. A namespace other than `NS`
// holds no spreadsheets the tests look at.
let nodeNamespaces: { namespaceId: string; name: string }[] = [];

// A read that is in flight for one render and then answers with whatever the
// node holds at that moment — the shape of mero-react's resource hooks, which
// also read again when their input (`key`) changes.
function useFakeRead<T>(read: () => T, key: unknown = null) {
  const [state, setState] = useState(() => ({ data: read(), loading: true }));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => setState({ data: read(), loading: false }), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, key]);
  const refetch = async () => setTick((t) => t + 1);
  return { ...state, refetch };
}

// Stable across renders, like the real provider's client.
const mero = { admin: {} };

vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@calimero-network/mero-react')>()),
  useMero: () => ({ mero, contextId: null, contextIdentity: null }),
  useNamespacesForApplication: () => {
    const { data, loading, refetch } = useFakeRead(() => nodeNamespaces);
    return { namespaces: data, loading, refetch };
  },
  useGroupContexts: (namespaceId: string | null) => {
    const { data, loading, refetch } = useFakeRead(
      () => (namespaceId === NS ? nodeContexts : [{ contextId: 'ctx-old', name: 'Old sheet' }]),
      namespaceId,
    );
    return { contexts: data, loading, refetch };
  },
}));

vi.mock('./useApplicationId', () => ({
  useApplicationId: () => ({
    appId: 'app-1',
    resolving: false,
    notInstalled: false,
  }),
}));

describe('useWorkspace right after joining a workspace', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.clear();
    nodeContexts = [];
    nodeNamespaces = [{ namespaceId: NS, name: 'Team' }];
    markNamespaceJustJoined(NS);
  });

  afterEach(() => {
    // A hook left mounted keeps polling and clears the next test's flag.
    cleanup();
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

    await waitFor(() =>
      expect(result.current.workspaces.map((w) => w.name)).toEqual(['Q3 Budget']),
    );
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

  // Someone who already has a workspace joins another. Right after the join
  // the node may not list the new namespace yet, and the hook fell back to the
  // first one listed: the gate watched that (never just joined), so nothing
  // re-read the node and nothing ever cleared the joined namespace's flag. The
  // invitation dialog sat on "Syncing…" until its ceiling.
  it('watches the joined workspace, not one already held, until the node lists it', async () => {
    nodeNamespaces = [{ namespaceId: 'ns-old', name: 'Mine' }];
    nodeContexts = [{ contextId: 'ctx-1', name: 'Q3 Budget' }];
    const { result } = renderHook(() => useWorkspace());
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.namespaceId).toBe('ns-old');

    await act(() => result.current.landJoined({ namespaceId: NS, contextId: null }));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.isSyncing).toBe(true);
    expect(isNamespaceJustJoined(NS)).toBe(true);

    // The node lists the joined namespace a few seconds later.
    nodeNamespaces = [
      { namespaceId: 'ns-old', name: 'Mine' },
      { namespaceId: NS, name: 'Team' },
    ];
    await act(() => vi.advanceTimersByTimeAsync(6_000));

    await waitFor(() => expect(isNamespaceJustJoined(NS)).toBe(false));
    expect(result.current.namespaceId).toBe(NS);
    expect(result.current.workspaces.map((w) => w.name)).toEqual(['Q3 Budget']);
    expect(result.current.isSyncing).toBe(false);
  });

  // The invitation is to the workspace this page already shows (the inviter
  // made a new spreadsheet in a workspace this node had joined before). The
  // gate's namespace does not change when the join marks it just-joined, and
  // useJoinSync only looks at the flag when its namespace changes, so it never
  // saw the flag, never cleared it, and the dialog sat on "Syncing…".
  it('notices a join of the workspace it already shows', async () => {
    sessionStorage.clear();
    nodeContexts = [{ contextId: 'ctx-1', name: 'Q3 Budget' }];
    const { result } = renderHook(() => useWorkspace());
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.namespaceId).toBe(NS);
    expect(result.current.isSyncing).toBe(false);

    // The redemption marks the namespace, then reports the join.
    nodeContexts = [...nodeContexts, { contextId: 'ctx-2', name: 'Payroll' }];
    act(() => markNamespaceJustJoined(NS));
    await act(() => result.current.landJoined({ namespaceId: NS, contextId: 'ctx-2' }));
    await act(() => vi.advanceTimersByTimeAsync(3_000));

    await waitFor(() => expect(isNamespaceJustJoined(NS)).toBe(false));
    expect(result.current.isSyncing).toBe(false);
    expect(result.current.workspaces.map((w) => w.name)).toEqual(['Q3 Budget', 'Payroll']);
  });
});
