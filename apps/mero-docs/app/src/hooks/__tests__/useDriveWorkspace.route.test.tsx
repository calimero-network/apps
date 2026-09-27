// The workspace provider against the URL, with every node read stubbed inert.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { DriveWorkspaceProvider, useDriveWorkspace } from '../useDriveWorkspace';
import { REGISTRY_CONTEXT_ALIAS } from '@/constants/config';

const stub = vi.hoisted(() => {
  const refetch = () => Promise.resolve();
  const none: never[] = [];
  const namespaces = () => ({
    namespaces: [{ namespaceId: 'ns1' }, { namespaceId: 'ns2' }],
    listed: true,
    loading: false,
    error: null,
    refetch: () => Promise.resolve(true),
  });
  return {
    none,
    refetch,
    mero: { mero: null, applicationId: 'app', isAuthenticated: true, isLoading: false },
    contexts: none as { contextId: string; name: string }[],
    namespaces: namespaces(),
    resetNamespaces() {
      this.namespaces = namespaces();
    },
  };
});

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => stub.mero,
  useGroupContexts: () => ({ contexts: stub.contexts, loading: false, refetch: stub.refetch }),
  useGroupInfo: () => ({ groupInfo: null, loading: false }),
  useGroupMembers: () => ({ members: stub.none, loading: false, refetch: stub.refetch }),
  useGroupMetadata: () => ({ metadata: null, loading: false, refetch: stub.refetch }),
  useSetGroupMetadata: () => ({ setGroupMetadata: stub.refetch }),
  useNodeIdentity: () => ({ identity: null, loading: false }),
  useSubgroups: () => ({ subgroups: stub.none, loading: false, refetch: stub.refetch }),
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

function Probe() {
  const { selectNamespace, setSelectedFolder, isJustJoined } = useDriveWorkspace();
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <output data-testid="url">{pathname}</output>
      <output data-testid="nav">{navigationType}</output>
      <output data-testid="just-joined">{String(isJustJoined)}</output>
      <button onClick={() => setSelectedFolder(null, { replace: true })}>leave</button>
      <button onClick={() => selectNamespace('ns1')}>ns1</button>
      <button onClick={() => selectNamespace('ns2')}>ns2</button>
    </>
  );
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <DriveWorkspaceProvider>
        <Probe />
      </DriveWorkspaceProvider>
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId('url').textContent;

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  stub.contexts = stub.none;
  stub.resetNamespaces();
});

describe('useDriveWorkspace and the URL', () => {
  it('opens the remembered workspace from /app', async () => {
    localStorage.setItem('mero-drive:activeNs', JSON.stringify('ns2'));
    renderAt('/app');
    await waitFor(() => expect(url()).toBe('/app/ns2'));
  });

  it('re-picking the open workspace keeps the open doc', () => {
    renderAt('/app/ns1/f/f1/d/doc-1');
    fireEvent.click(screen.getByRole('button', { name: 'ns1' }));
    expect(url()).toBe('/app/ns1/f/f1/d/doc-1');
  });

  it('leaving a folder with replace lands on workspace Home in its place', () => {
    renderAt('/app/ns1/f/f1/d/doc-1');
    fireEvent.click(screen.getByRole('button', { name: 'leave' }));
    expect(url()).toBe('/app/ns1');
    expect(screen.getByTestId('nav').textContent).toBe('REPLACE');
  });

  it('picking another workspace opens its Home', () => {
    renderAt('/app/ns1/f/f1/d/doc-1');
    fireEvent.click(screen.getByRole('button', { name: 'ns2' }));
    expect(url()).toBe('/app/ns2');
  });

  it('re-reads the workspace list before a just-joined workspace stops syncing', async () => {
    // The list is read on events only, so right after a join it can still predate it.
    sessionStorage.setItem('mero-drive:justJoined', JSON.stringify(['ns1']));
    stub.namespaces.namespaces = [{ namespaceId: 'ns2' }];
    let answer: (ok: boolean) => void = () => {};
    const refetch = vi.fn(() => new Promise<boolean>((r) => (answer = r)));
    stub.namespaces.refetch = refetch;
    stub.contexts = [{ contextId: 'reg', name: REGISTRY_CONTEXT_ALIAS }];
    renderAt('/app/ns1');
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(screen.getByTestId('just-joined').textContent).toBe('true');
    stub.namespaces.namespaces = [{ namespaceId: 'ns1' }, { namespaceId: 'ns2' }];
    await act(async () => answer(true));
    await waitFor(() =>
      expect(screen.getByTestId('just-joined').textContent).toBe('false'),
    );
    expect(url()).toBe('/app/ns1');
  });

  it('holds the just-joined gate when the list re-read fails', async () => {
    sessionStorage.setItem('mero-drive:justJoined', JSON.stringify(['ns1']));
    stub.namespaces.namespaces = [{ namespaceId: 'ns2' }];
    const refetch = vi.fn(() => Promise.resolve(false));
    stub.namespaces.refetch = refetch;
    stub.contexts = [{ contextId: 'reg', name: REGISTRY_CONTEXT_ALIAS }];
    renderAt('/app/ns1');
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0)); // let the failed read settle
    expect(screen.getByTestId('just-joined').textContent).toBe('true');
  });
});
