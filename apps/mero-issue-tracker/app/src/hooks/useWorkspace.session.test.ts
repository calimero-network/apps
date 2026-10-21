// @vitest-environment jsdom
/**
 * Whether the workspace list has answered, as the onboarding pane reads it.
 *
 * An empty list is the cue for "Create workspace". On an account the list is
 * scoped by an application id the provider learns from the registry AFTER
 * sign-in, so for a while there is no id and nothing has been asked: the list
 * reads empty, and the pane told an account that has workspaces it had none.
 * A failed list read empty in the same way. Creating one from either founds a
 * duplicate. These drive the real hook (and mero-react's real list hook).
 */
import { createElement, type ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The roster, identity and event stream are not what is under test.
  useGroupMembers: () => ({ members: [], loading: false, error: null, refetch: async () => {} }),
  useNodeIdentity: () => ({ identity: null, loading: false, error: null, refetch: async () => {} }),
  useSubscription: () => {},
}));
const appIdState = vi.hoisted(() => ({ appId: 'app-1' }));
vi.mock('./useApplicationId', () => ({
  // On an account this hook answers `useMero().applicationId ?? ''` and never "resolving".
  useApplicationId: () => ({ appId: appIdState.appId, resolving: false, notInstalled: false }),
}));
vi.mock('./useMemberRoles', () => ({ useMemberRoles: () => ({}) }));
vi.mock('./useStreamReconnect', () => ({ useStreamReconnect: () => {} }));

const { MeroContext } = await import('@calimero-network/mero-react');
const { useWorkspace } = await import('./useWorkspace');

const admin = {
  listNamespacesForApplication: vi.fn(),
  listGroupContexts: vi.fn(async () => []),
  getContextIdentitiesOwned: vi.fn(async () => ({ identities: [] })),
};

function render(isDelegated: boolean) {
  const value = { mero: {}, admin, isDelegated, applicationId: null, contextId: null, contextIdentity: null };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MeroContext.Provider, { value: value as never }, children);
  return renderHook(() => useWorkspace(), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  admin.listNamespacesForApplication.mockReset();
});

afterEach(() => cleanup());

describe('useWorkspace: has the workspace list answered?', () => {
  it('is pending on an account until the application id lands, not empty', async () => {
    appIdState.appId = '';
    const { result } = render(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.namespaces).toEqual([]);
    expect(result.current.namespacesPending).toBe(true);
    expect(result.current.namespacesFailed).toBe(false);
  });

  it('is pending on a node until the list answers, then answered', async () => {
    appIdState.appId = 'app-1';
    let answer!: (v: unknown) => void;
    admin.listNamespacesForApplication.mockReturnValue(new Promise((r) => (answer = r)));
    const { result } = render(false);
    expect(result.current.namespacesPending).toBe(true);
    answer([]);
    await waitFor(() => expect(result.current.namespacesPending).toBe(false));
    expect(result.current.namespacesFailed).toBe(false);
  });

  it('says a failed list failed, rather than reading as no workspaces', async () => {
    appIdState.appId = 'app-1';
    admin.listNamespacesForApplication.mockRejectedValue(new Error('relay unreachable'));
    const { result } = render(false);
    await waitFor(() => expect(result.current.namespacesFailed).toBe(true));
    expect(result.current.namespacesPending).toBe(false);
  });

  it('is not pending on a node where the app is not installed (nothing is asked)', async () => {
    appIdState.appId = '';
    const { result } = render(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.namespacesPending).toBe(false);
    expect(admin.listNamespacesForApplication).not.toHaveBeenCalled();
  });
});
