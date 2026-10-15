// @vitest-environment jsdom
/**
 * The first minute after accepting an invitation, as `useWorkspace` lives it.
 *
 * Right after a join the node may not hold the workspace's repos yet: the
 * repo list reads EMPTY, and joining a repo that has not replicated is
 * refused. Both used to be taken as final - one empty read ended "Syncing…"
 * for good and left "No repos yet" until a reload, and one refused join
 * left the board loading forever. These drive the real hook (and mero-react's
 * real list and join-sync hooks) against a node that catches up late.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The roster, identity and event stream are not what is under test.
  useGroupMembers: () => ({ members: [], loading: false, error: null, refetch: async () => {} }),
  useNodeIdentity: () => ({ identity: null, loading: false, error: null, refetch: async () => {} }),
  useSubscription: () => {},
}));
vi.mock('./useApplicationId', () => ({
  useApplicationId: () => ({ appId: 'app-1', resolving: false, notInstalled: false }),
}));
vi.mock('./useMemberRoles', () => ({ useMemberRoles: () => ({}) }));
vi.mock('./useStreamReconnect', () => ({ useStreamReconnect: () => {} }));

const { MeroContext, isNamespaceJustJoined, clearNamespaceJustJoined } = await import(
  '@calimero-network/mero-react'
);
const { announceJoined } = await import('./joinedWorkspace');
const { useWorkspace } = await import('./useWorkspace');
const { readActiveNs, writeActiveNs } = await import('./workspacePersistence');

const NS = 'ns-joined';
const REPO = { contextId: 'ctx-core', name: 'core' };

const admin = {
  listNamespacesForApplication: vi.fn(),
  listGroupContexts: vi.fn(),
  getContextMetadata: vi.fn(async () => null),
  getContextIdentitiesOwned: vi.fn(),
  joinContext: vi.fn(),
};

function render() {
  const value = { mero: {}, admin, isDelegated: false, applicationId: null, contextId: null, contextIdentity: null };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MeroContext.Provider, { value: value as never }, children);
  return renderHook(() => useWorkspace(), { wrapper });
}

/** Accept the invitation: the namespace is listed from now on, and the app enters it. */
async function join() {
  admin.listNamespacesForApplication.mockResolvedValue([{ namespaceId: NS, name: 'Team' }]);
  await act(async () => announceJoined(NS));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  sessionStorage.clear();
  for (const fn of Object.values(admin)) fn.mockReset();
  admin.getContextMetadata.mockResolvedValue(null);
  // Before the join this node holds no workspace for the app.
  admin.listNamespacesForApplication.mockResolvedValue([]);
  admin.getContextIdentitiesOwned.mockResolvedValue({ identities: [] });
});

afterEach(() => {
  cleanup();
  clearNamespaceJustJoined(NS);
  vi.useRealTimers();
});

describe('useWorkspace right after a join: the repo list', () => {
  it('keeps syncing through empty reads and shows the repos once they arrive', async () => {
    admin.listGroupContexts.mockResolvedValue([]);
    admin.joinContext.mockResolvedValue({ memberPublicKey: 'pk-me' });
    const { result } = render();
    await join();

    await waitFor(() => expect(result.current.activeNs).toBe(NS));
    await waitFor(() => expect(admin.listGroupContexts).toHaveBeenCalled());
    await act(() => vi.advanceTimersByTimeAsync(100));
    // An empty list this early is the node not having the repos yet.
    expect(result.current.isSyncing).toBe(true);
    expect(isNamespaceJustJoined(NS)).toBe(true);

    admin.listGroupContexts.mockResolvedValue([REPO]);
    await act(() => vi.advanceTimersByTimeAsync(2_500));

    await waitFor(() => expect(result.current.repos.map((p) => p.contextId)).toEqual([REPO.contextId]));
    expect(result.current.isSyncing).toBe(false);
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  it('waits past the base window while the list is empty, then takes empty as the answer', async () => {
    admin.listGroupContexts.mockResolvedValue([]);
    const { result } = render();
    await join();
    await waitFor(() => expect(result.current.activeNs).toBe(NS));

    await act(() => vi.advanceTimersByTimeAsync(40_000));
    expect(result.current.isSyncing).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(90_000));
    expect(result.current.isSyncing).toBe(false);
    expect(isNamespaceJustJoined(NS)).toBe(false);
    expect(result.current.repos).toEqual([]);

    // A genuinely empty workspace is not polled once the gate has given up.
    const reads = admin.listGroupContexts.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(admin.listGroupContexts.mock.calls.length).toBe(reads);
  });
});

describe('useWorkspace right after a join: joining the active repo', () => {
  it('retries a join the node refuses until it is let in', async () => {
    admin.listGroupContexts.mockResolvedValue([REPO]);
    admin.joinContext
      .mockRejectedValueOnce(new Error('context not found'))
      .mockRejectedValueOnce(new Error('context not found'))
      .mockResolvedValue({ memberPublicKey: 'pk-me' });
    const { result } = render();
    await join();

    await waitFor(() => expect(result.current.activeRepo).toBe(REPO.contextId));
    await waitFor(() => expect(admin.joinContext).toHaveBeenCalledTimes(1));
    expect(result.current.executorPublicKey).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => expect(result.current.executorPublicKey).toBe('pk-me'));
    expect(result.current.ready).toBe(true);
    expect(admin.joinContext).toHaveBeenCalledTimes(3);
  });

  it('gives up on a join that is never accepted', async () => {
    admin.listGroupContexts.mockResolvedValue([REPO]);
    admin.joinContext.mockRejectedValue(new Error('context not found'));
    const { result } = render();
    await join();
    await waitFor(() => expect(result.current.activeRepo).toBe(REPO.contextId));

    await act(() => vi.advanceTimersByTimeAsync(100_000));
    const tries = admin.joinContext.mock.calls.length;
    expect(tries).toBeGreaterThan(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(admin.joinContext.mock.calls.length).toBe(tries);
    expect(result.current.executorPublicKey).toBeNull();
  });
});

describe('useWorkspace on a reload', () => {
  it('keeps the persisted workspace through the empty list it starts with', async () => {
    // The list reads `[]` until the node answers; that is not "no workspaces".
    writeActiveNs(NS);
    admin.listNamespacesForApplication.mockResolvedValue([{ namespaceId: 'ns-first' }, { namespaceId: NS }]);
    admin.listGroupContexts.mockResolvedValue([]);
    const { result } = render();

    await waitFor(() => expect(admin.listNamespacesForApplication).toHaveBeenCalled());
    await waitFor(() => expect(result.current.namespaces).toHaveLength(2));
    expect(result.current.activeNs).toBe(NS);
    expect(readActiveNs()).toBe(NS);
  });
});
