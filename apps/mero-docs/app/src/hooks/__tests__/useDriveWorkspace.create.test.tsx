// "New workspace" on a delegated (account) session.
//
// The raw client's admin (`useMero().mero.admin`) is the relay's node route
// under the account's bearer token: `POST /admin-api/namespaces` answered 403
// ("Token does not carry the permissions this route requires") and the dialog
// showed it. `createWorkspace` must found through the session-aware
// `useMero().admin` - the account admin, whose `createNamespace` founds via the
// relay with the provider's package - and seed the registry context through
// the same client, inside the new namespace's root group. The raw client is
// never reached.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DriveWorkspaceProvider, useDriveWorkspace } from '../useDriveWorkspace';
import { REGISTRY_CONTEXT_ALIAS, REGISTRY_SERVICE_ID } from '@/constants/config';

const stub = vi.hoisted(() => {
  const refetch = () => Promise.resolve();
  const none: never[] = [];
  // The session-aware admin the hook must create through.
  const admin = {
    createNamespace: vi.fn(async () => ({ namespaceId: 'ns-new' })),
    setDefaultCapabilities: vi.fn(async () => {}),
    createContext: vi.fn(async () => ({ contextId: 'reg-new', memberPublicKey: 'acct' })),
    listGroupMembers: vi.fn(async () => ({ members: [] })),
    listGroupContexts: vi.fn(async () => []),
    getGroupInfo: vi.fn(() => new Promise(() => {})),
  };
  // The RAW client's admin: the relay's node route, a 403 for an account. These
  // spies exist to prove the hook never reaches it.
  const rawAdmin = {
    createNamespace: vi.fn(),
    setDefaultCapabilities: vi.fn(),
    createContext: vi.fn(),
  };
  return {
    none,
    refetch,
    admin,
    rawAdmin,
    mero: {
      mero: { admin: rawAdmin },
      admin,
      isDelegated: true,
      applicationId: 'app',
      isAuthenticated: true,
      isLoading: false,
    },
  };
});

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => stub.mero,
  useGroupContexts: () => ({ contexts: stub.none, loading: false, refetch: stub.refetch }),
  useGroupInfo: () => ({ groupInfo: null, loading: false }),
  useGroupMembers: () => ({ members: stub.none, loading: false, refetch: stub.refetch }),
  useGroupMetadata: () => ({ metadata: null, loading: false, refetch: stub.refetch }),
  useSetGroupMetadata: () => ({ setGroupMetadata: stub.refetch }),
  useNodeIdentity: () => ({ identity: null, loading: false }),
  useSubgroups: () => ({ subgroups: stub.none, loading: false, refetch: stub.refetch }),
}));
vi.mock('../useAppNamespaces', () => ({
  useAppNamespaces: () => ({
    namespaces: stub.none,
    listed: true,
    loading: false,
    error: null,
    refetch: stub.refetch,
  }),
}));
// On an account the id is the registry's, via the provider (see useApplicationId).
vi.mock('../useApplicationId', () => ({
  useApplicationId: () => ({
    appId: 'app',
    resolving: false,
    inconclusive: false,
    notInstalled: false,
  }),
}));
vi.mock('../useNamespaceDisplayNames', () => ({
  useNamespaceDisplayNames: <T,>(ns: T) => ns,
}));
vi.mock('../useSyncStatus', () => ({ useSyncStatus: () => null }));
vi.mock('../useContextEvents', () => ({ useContextEvents: () => {} }));

function Probe() {
  const { createWorkspace, createWorkspaceError } = useDriveWorkspace();
  return (
    <>
      <output data-testid="error">{createWorkspaceError?.message ?? ''}</output>
      <button onClick={() => void createWorkspace('Acme')}>new</button>
    </>
  );
}

function renderApp() {
  render(
    <MemoryRouter initialEntries={['/app']}>
      <DriveWorkspaceProvider>
        <Probe />
      </DriveWorkspaceProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('createWorkspace on a delegated session', () => {
  it('founds through admin.createNamespace and seeds the registry through admin.createContext in the new root group, never the raw client', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'new' }));

    await waitFor(() => expect(stub.admin.createContext).toHaveBeenCalledTimes(1));
    expect(stub.admin.createNamespace).toHaveBeenCalledTimes(1);
    expect(stub.admin.createNamespace).toHaveBeenCalledWith({
      applicationId: 'app',
      name: 'Acme',
    });
    expect(stub.admin.createContext).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app',
        groupId: 'ns-new',
        serviceName: REGISTRY_SERVICE_ID,
        name: REGISTRY_CONTEXT_ALIAS,
      }),
    );
    // Best-effort member defaults go the same way.
    expect(stub.admin.setDefaultCapabilities).toHaveBeenCalledWith('ns-new', expect.anything());
    expect(screen.getByTestId('error').textContent).toBe('');

    expect(stub.rawAdmin.createNamespace).not.toHaveBeenCalled();
    expect(stub.rawAdmin.setDefaultCapabilities).not.toHaveBeenCalled();
    expect(stub.rawAdmin.createContext).not.toHaveBeenCalled();
  });

  it("surfaces the admin's refusal on the dialog instead of swallowing it", async () => {
    stub.admin.createNamespace.mockRejectedValueOnce(
      new Error('createNamespace without a packageName is not available for an account: it needs a node'),
    );
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'new' }));
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toMatch(/not available for an account/),
    );
    expect(stub.admin.createContext).not.toHaveBeenCalled();
    expect(stub.rawAdmin.createNamespace).not.toHaveBeenCalled();
  });
});
