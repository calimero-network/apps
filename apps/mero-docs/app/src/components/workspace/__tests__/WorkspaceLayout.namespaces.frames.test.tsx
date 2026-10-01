// Every committed frame of a workspace reload, with the real workspace provider
// and namespace read. The act environment is off so updates land as in a browser.
import React, { useLayoutEffect, useSyncExternalStore } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MeroContextValue } from '@calimero-network/mero-react';
import { DriveWorkspaceProvider, useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { WorkspaceLayout } from '../WorkspaceLayout';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let appId = { appId: null as string | null, resolving: true };
  let rejectList: (e: Error) => void = () => {};
  let resolveList: (v: { namespaceId: string }[]) => void = () => {};
  const none: never[] = [];
  const refetch = () => Promise.resolve();
  return {
    cards: [] as string[],
    none,
    refetch,
    listNamespacesForApplication: () =>
      new Promise<{ namespaceId: string }[]>((res, rej) => {
        resolveList = res;
        rejectList = rej;
      }),
    resolveList: (v: { namespaceId: string }[]) => resolveList(v),
    rejectList: (e: Error) => rejectList(e),
    get appId() {
      return appId;
    },
    setAppId(next: typeof appId) {
      appId = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});

vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: () => ({ name: null }),
}));
vi.mock('@calimero-network/mero-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@calimero-network/mero-react')>();
  return {
    MeroContext: actual.MeroContext,
    useMero: actual.useMero,
    useGroupContexts: () => ({ contexts: h.none, loading: false, refetch: h.refetch }),
    useGroupInfo: () => ({ groupInfo: null, loading: false }),
    useGroupMembers: () => ({ members: h.none, loading: false, refetch: h.refetch }),
    useGroupMetadata: () => ({ metadata: null, loading: false, refetch: h.refetch }),
    useSetGroupMetadata: () => ({ setGroupMetadata: h.refetch }),
    useNodeIdentity: () => ({ identity: null, loading: false }),
    useSubgroups: () => ({ subgroups: h.none, loading: false, refetch: h.refetch }),
    useJoinContext: () => ({ joinContext: h.refetch }),
  };
});
vi.mock('@/hooks/useApplicationId', () => ({
  useApplicationId: () => {
    const { appId, resolving } = useSyncExternalStore(h.subscribe, () => h.appId);
    return { appId, resolving, inconclusive: false, notInstalled: false };
  },
}));
vi.mock('@/hooks/useNamespaceDisplayNames', () => ({
  useNamespaceDisplayNames: <T,>(ns: T) => ns,
}));
vi.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: () => null }));
vi.mock('@/hooks/useContextEvents', () => ({ useContextEvents: () => {} }));
vi.mock('../LinkTargetCard', () => ({
  LinkTargetCard: ({ kind }: { kind: string }) => {
    useLayoutEffect(() => {
      h.cards.push(kind);
    });
    return <div data-testid="card">{kind}</div>;
  },
}));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('@/hooks/useWorkspacePresence', () => ({
  usePublishWorkspacePresence: () => {},
}));
// The layout's own screens are under test; the index has its own suite.
vi.mock('@/context/WorkspaceIndexContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/WorkspaceIndexContext')>()),
  WorkspaceIndexProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/theme/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../NamespaceSwitcher', () => ({ NamespaceSwitcher: () => null }));
vi.mock('../DisplayNameGate', () => ({
  DisplayNameGate: () => <div data-testid="name-gate" />,
}));
vi.mock('../NamespaceSettingsPanel', () => ({ NamespaceSettingsPanel: () => null }));
vi.mock('@/components/folders/FolderTree', () => ({ FolderTree: () => null }));
vi.mock('@/components/home/HomePage', () => ({
  HomePage: () => <div data-testid="home" />,
}));

window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: true,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

const tick = () => new Promise((r) => setTimeout(r, 0));

// Stands in for the debounced SSE re-read of the workspace list.
function Refetch() {
  const { refetch } = useDriveWorkspace();
  return <button onClick={() => void refetch()}>refetch</button>;
}

const meroValue = {
  mero: { admin: { listNamespacesForApplication: h.listNamespacesForApplication } },
  nodeUrl: 'http://node',
  logout: () => {},
  isAuthenticated: true,
  isLoading: false,
  applicationId: null,
} as unknown as MeroContextValue;

async function reloadWorkspace() {
  // Imported lazily so the partial mock above has resolved first.
  const { MeroContext } = await import('@calimero-network/mero-react');
  render(
    <MeroContext.Provider value={meroValue}>
      <MemoryRouter initialEntries={['/app/ns1']}>
        <DriveWorkspaceProvider>
          <Routes>
            <Route path="/app/*" element={<WorkspaceLayout />} />
          </Routes>
          <Refetch />
        </DriveWorkspaceProvider>
      </MemoryRouter>
    </MeroContext.Provider>,
    { wrapper: ConfirmProvider },
  );
  await tick();
  h.setAppId({ appId: 'app', resolving: false });
  await tick();
}

let actEnv: unknown;
beforeAll(() => {
  actEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = actEnv;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  h.cards.length = 0;
  h.setAppId({ appId: null, resolving: true });
});

describe('WorkspaceLayout workspace reload frames', () => {
  it('never commits not-in-workspace while the workspace list is still loading', async () => {
    await reloadWorkspace();
    h.resolveList([{ namespaceId: 'ns1' }]);
    expect(await screen.findByTestId('home')).toBeTruthy();
    expect(h.cards).not.toContain('not-in-workspace');
  });

  it('never commits not-in-workspace after a failed workspace list read', async () => {
    await reloadWorkspace();
    h.rejectList(new Error('node unreachable'));
    await tick();
    await tick();
    expect(h.cards).not.toContain('not-in-workspace');
  });

  it('keeps Home and the name gate when a later list read fails', async () => {
    await reloadWorkspace();
    h.resolveList([{ namespaceId: 'ns1' }]);
    expect(await screen.findByTestId('home')).toBeTruthy();
    expect(await screen.findByTestId('name-gate')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'refetch' }));
    await tick();
    h.rejectList(new Error('node unreachable'));
    await tick();
    await tick();
    expect(screen.getByTestId('home')).toBeTruthy();
    expect(screen.getByTestId('name-gate')).toBeTruthy();
    expect(screen.queryByText("Couldn't load your workspaces")).toBeNull();
    expect(h.cards).toHaveLength(0);
  });

  it('shows not-in-workspace once a successful list leaves this workspace out', async () => {
    await reloadWorkspace();
    h.resolveList([{ namespaceId: 'other' }]);
    expect((await screen.findByTestId('card')).textContent).toBe('not-in-workspace');
  });
});
