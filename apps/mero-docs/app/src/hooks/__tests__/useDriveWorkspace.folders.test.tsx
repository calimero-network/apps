// A refetch captured before a workspace switch must not load the old workspace's
// folders under the new one, nor drop the new workspace's own read.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  DriveWorkspaceProvider,
  useDriveWorkspace,
} from '../useDriveWorkspace';
import { REGISTRY_CONTEXT_ALIAS } from '@/constants/config';
import { HTTPError } from '@calimero-network/mero-js';

const stub = vi.hoisted(() => {
  const refetch = () => Promise.resolve();
  const none: never[] = [];
  // Each getFolders call per registry context, resolved by the test.
  const reads: Record<string, ((rows: { id: string }[]) => void)[]> = {};
  return {
    none,
    refetch,
    reads,
    mero: {
      mero: { admin: { getGroupInfo: () => new Promise(() => {}) } },
      // The session admin the hook reads; absent, the access fan-out stays off.
      admin: undefined as
        | { getGroupInfo: (id: string) => Promise<unknown> }
        | undefined,
      applicationId: 'app',
      isAuthenticated: true,
      isLoading: false,
    },
    namespaces: {
      namespaces: [{ namespaceId: 'ns1' }, { namespaceId: 'ns2' }],
      listed: true,
      loading: false,
      error: null,
      refetch,
    },
  };
});

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => stub.mero,
  useGroupContexts: (ns?: string) => ({
    contexts: ns
      ? [{ contextId: `reg-${ns}`, name: REGISTRY_CONTEXT_ALIAS }]
      : stub.none,
    loading: false,
    refetch: stub.refetch,
  }),
  useGroupInfo: () => ({ groupInfo: null, loading: false }),
  useGroupMembers: () => ({
    members: stub.none,
    loading: false,
    refetch: stub.refetch,
  }),
  useGroupMetadata: () => ({
    metadata: null,
    loading: false,
    refetch: stub.refetch,
  }),
  useSetGroupMetadata: () => ({ setGroupMetadata: stub.refetch }),
  useNodeIdentity: () => ({ identity: { accountId: 'me' }, loading: false }),
  useSubgroups: () => ({
    subgroups: stub.none,
    loading: false,
    refetch: stub.refetch,
  }),
}));
vi.mock('../../generated/registry/RegistryClient', () => ({
  RegistryClient: class {
    constructor(
      _mero: unknown,
      private contextId: string,
    ) {}
    getFolders() {
      return new Promise((resolve) => {
        (stub.reads[this.contextId] ??= []).push(resolve);
      });
    }
    getOwner = () => Promise.resolve('me');
    listManagers = () => Promise.resolve([]);
  },
}));
vi.mock('../useAppNamespaces', () => ({
  useAppNamespaces: () => stub.namespaces,
}));
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

let captured: (() => Promise<void>) | null = null;

function Probe() {
  const { allFolderNodes, refetch, selectNamespace } = useDriveWorkspace();
  return (
    <>
      <output data-testid="folders">
        {allFolderNodes.map((f) => f.id).join(',')}
      </output>
      <button onClick={() => (captured = refetch)}>capture</button>
      <button onClick={() => selectNamespace('ns2')}>ns2</button>
    </>
  );
}

const folders = () => screen.getByTestId('folders').textContent;

afterEach(() => {
  stub.mero.admin = undefined;
  localStorage.clear();
  for (const key of Object.keys(stub.reads)) delete stub.reads[key];
  captured = null;
});

describe('useDriveWorkspace folder reads across a workspace switch', () => {
  it("lands the new workspace's folders, never the old one's from a captured refetch", async () => {
    render(
      <MemoryRouter initialEntries={['/app/ns1']}>
        <DriveWorkspaceProvider>
          <Probe />
        </DriveWorkspaceProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(stub.reads['reg-ns1']).toHaveLength(1));
    await act(async () => stub.reads['reg-ns1'][0]([{ id: 'a1' }]));
    expect(folders()).toBe('a1');

    fireEvent.click(screen.getByRole('button', { name: 'capture' }));
    fireEvent.click(screen.getByRole('button', { name: 'ns2' }));
    await waitFor(() => expect(stub.reads['reg-ns2']).toHaveLength(1));

    await act(async () => {
      void captured?.();
    });
    await act(async () => {
      for (const resolve of stub.reads['reg-ns1']) resolve([{ id: 'a2' }]);
      stub.reads['reg-ns2'][0]([{ id: 'b1' }]);
    });

    await waitFor(() => expect(folders()).toBe('b1'));
  });
});

function Listed() {
  const { folders, unsyncedFolderIds } = useDriveWorkspace();
  return (
    <>
      <output data-testid="listed">{folders.map((f) => f.id).join(',')}</output>
      <output data-testid="unsynced">{[...unsyncedFolderIds].join(',')}</output>
    </>
  );
}

describe('useDriveWorkspace folders whose group is not on this node', () => {
  it('withholds them from the folder list instead of showing them', async () => {
    stub.mero.admin = {
      getGroupInfo: (id: string) =>
        id === 'missing'
          ? Promise.reject(
              new HTTPError(
                404,
                '',
                `/admin-api/groups/${id}`,
                new Headers(),
                `{"error":"group '${id}' not found"}`,
              ),
            )
          : Promise.resolve({
              metadata: { name: id },
              subgroupVisibility: 'open',
            }),
    };
    render(
      <MemoryRouter initialEntries={['/app/ns1']}>
        <DriveWorkspaceProvider>
          <Listed />
        </DriveWorkspaceProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(stub.reads['reg-ns1']).toHaveLength(1));
    await act(async () =>
      stub.reads['reg-ns1'][0]([{ id: 'known' }, { id: 'missing' }]),
    );

    await waitFor(() =>
      expect(screen.getByTestId('unsynced').textContent).toBe('missing'),
    );
    expect(screen.getByTestId('listed').textContent).toBe('known');
  });
});
