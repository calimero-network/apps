// A routed folder/doc/workspace the caller can't open shows LinkTargetCard
// instead of silently dropping them on Home or hanging the editor.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WorkspaceLayout } from '../WorkspaceLayout';

const workspace = vi.hoisted(() => ({
  namespaces: [{ namespaceId: 'ns' }],
  namespacesListed: true,
  isJustJoined: false,
  namespacesError: null as Error | null,
  registryFolders: [{ id: 'f1', parent_id: null, color: null, alias: 'Finance' }] as
    | { id: string; parent_id: string | null; color: string | null; alias?: string | null }[]
    | null,
  resolvedFolderIds: new Set(['f1']),
  hiddenFolderIds: new Set<string>(),
}));
const docs = vi.hoisted(() => ({
  list: [{ id: 'doc-1' }] as { id: string }[],
  loading: false,
  listed: true,
  contextResolving: false,
  error: null as Error | null,
}));
const useDocsSpy = vi.hoisted(() => vi.fn());
const docsRefetch = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const workspaceRefetch = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/hooks/useDriveWorkspace', async () => {
  const { useAppRoute } = await import('@/hooks/useAppRoute');
  return {
    useDriveWorkspace: () => ({
      namespaceId: useAppRoute().route?.ws ?? null,
      namespaces: workspace.namespaces,
      namespacesListed: workspace.namespacesListed,
      isJustJoined: workspace.isJustJoined,
      namespacesError: workspace.namespacesError,
      registryContextId: 'reg',
      selectedFolderId: useAppRoute().route?.folder ?? null,
      setSelectedFolder: vi.fn(),
      folders: [],
      registryFolders: workspace.registryFolders,
      resolvedFolderIds: workspace.resolvedFolderIds,
      hiddenFolderIds: workspace.hiddenFolderIds,
      selfIdentity: 'me',
      stage: 'ready',
      syncStatus: null,
      refetch: workspaceRefetch,
    }),
  };
});
vi.mock('@/hooks/useDocs', () => ({
  useDocs: (folderId: string | null, opts?: unknown) => {
    useDocsSpy(folderId, opts);
    return {
      list: docs.list,
      loading: docs.loading,
      listed: docs.listed,
      contextResolving: docs.contextResolving,
      contextId: 'ctx',
      error: docs.error,
      refetch: docsRefetch,
      create: vi.fn(),
      edit: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
      client: null,
    };
  },
}));
vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMero: () => ({ mero: null, nodeUrl: 'http://node', logout: vi.fn() }),
}));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('@/hooks/useWorkspacePresence', () => ({
  usePublishWorkspacePresence: () => {},
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ loading: false, caps: 0, refetch: vi.fn() }),
}));
// The layout's own screens are under test; the index has its own suite.
vi.mock('@/context/WorkspaceIndexContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/WorkspaceIndexContext')>()),
  WorkspaceIndexProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/theme/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../NamespaceSwitcher', () => ({ NamespaceSwitcher: () => null }));
vi.mock('@/components/home/HomePage', () => ({
  HomePage: () => <div data-testid="home" />,
}));
vi.mock('../DisplayNameGate', () => ({
  DisplayNameGate: () => <div data-testid="name-gate" />,
}));
vi.mock('../NamespaceSettingsPanel', () => ({
  NamespaceSettingsPanel: () => null,
}));
vi.mock('@/components/docs/DocumentEditor', () => ({
  DocumentEditor: () => <div data-testid="editor" />,
}));
vi.mock('@/components/folders/FolderTree', () => ({ FolderTree: () => null }));

window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: true,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

function Url() {
  const { pathname } = useLocation();
  return <output data-testid="url">{pathname}</output>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/app/*"
          element={
            <>
              <WorkspaceLayout />
              <Url />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  useDocsSpy.mockClear();
  workspace.namespaces = [{ namespaceId: 'ns' }];
  workspace.namespacesListed = true;
  workspace.isJustJoined = false;
  workspace.namespacesError = null;
  workspaceRefetch.mockClear();
  workspace.registryFolders = [
    { id: 'f1', parent_id: null, color: null, alias: 'Finance' },
  ];
  workspace.resolvedFolderIds = new Set(['f1']);
  workspace.hiddenFolderIds = new Set();
  docs.list = [{ id: 'doc-1' }];
  docs.loading = false;
  docs.listed = true;
  docs.contextResolving = false;
  docs.error = null;
  docsRefetch.mockClear();
});

describe('WorkspaceLayout: routed target the caller cannot open', () => {
  it('shows a not-in-workspace card for a workspace this node is not in', () => {
    workspace.namespaces = [{ namespaceId: 'other' }];
    renderAt('/app/ns');
    expect(screen.getByText('You are not in this workspace')).toBeTruthy();
    expect(screen.queryByTestId('home')).toBeNull();
  });

  it('does not treat an empty, not yet listed namespace list as not-in-workspace', () => {
    workspace.namespaces = [];
    workspace.namespacesListed = false;
    renderAt('/app/ns');
    expect(screen.queryByText('You are not in this workspace')).toBeNull();
  });

  it('treats a genuinely empty namespace list (listed) as not-in-workspace', () => {
    workspace.namespaces = [];
    workspace.namespacesListed = true;
    renderAt('/app/ns');
    expect(screen.getByText('You are not in this workspace')).toBeTruthy();
  });

  it('shows syncing, not not-in-workspace, for a just-joined workspace', () => {
    workspace.namespaces = [{ namespaceId: 'other' }];
    workspace.isJustJoined = true;
    renderAt('/app/ns');
    expect(screen.queryByText('You are not in this workspace')).toBeNull();
    expect(
      screen.getByText('Syncing workspace from peers…'),
    ).toBeTruthy();
  });

  it('names the folder for a link into a restricted folder', () => {
    workspace.hiddenFolderIds = new Set(['f1']);
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.getByText('This document is in Finance')).toBeTruthy();
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('does not fetch docs for a hidden folder (no join attempt on a link)', () => {
    workspace.hiddenFolderIds = new Set(['f1']);
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(useDocsSpy).toHaveBeenCalledWith(null, { includeArchived: true });
  });

  it('waits quietly, not with a premature no-access, while a folder’s access is unresolved', async () => {
    workspace.resolvedFolderIds = new Set();
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.queryByText('This document is in Finance')).toBeNull();
    expect(await screen.findByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('Syncing workspace from peers…')).toBeNull();
  });

  it('shows nothing for a short wait, then a quiet loader', async () => {
    workspace.resolvedFolderIds = new Set();
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(await screen.findByText('Loading…')).toBeTruthy();
  });

  it('shows the doc-worded deleted card for an unknown doc in a real folder', async () => {
    renderAt('/app/ns/f/f1/d/gone');
    expect(await screen.findByText('This document was deleted or moved')).toBeTruthy();
    // Only after a fresh read, not straight off the cached list.
    expect(docsRefetch).toHaveBeenCalledTimes(1);
  });

  it('opens the doc once it resolves', async () => {
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(await screen.findByTestId('editor')).toBeTruthy();
  });

  it('waits (never a premature deleted) while the folder list has not loaded', async () => {
    workspace.registryFolders = null;
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.queryByText('This document was deleted or moved')).toBeNull();
    expect(screen.queryByTestId('editor')).toBeNull();
    expect(await screen.findByText('Loading…')).toBeTruthy();
  });

  it('keeps an open doc mounted through a later syncing pulse', async () => {
    // A fresh element each time, so rerender actually re-renders the layout.
    const tree = () => (
      <MemoryRouter initialEntries={['/app/ns/f/f1/d/doc-1']}>
        <Routes>
          <Route path="/app/*" element={<WorkspaceLayout />} />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(tree());
    expect(await screen.findByTestId('editor')).toBeTruthy();
    // e.g. registryClient briefly churns identity mid-session.
    docs.listed = false;
    rerender(tree());
    expect(screen.getByTestId('editor')).toBeTruthy();
  });

  it('Go to Home on not-in-workspace leaves for /app, not this bad workspace', () => {
    workspace.namespaces = [{ namespaceId: 'other' }];
    renderAt('/app/ns');
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
    expect(screen.getByTestId('url').textContent).toBe('/app');
  });

  it('keeps an absent folder link and shows the folder-worded card', () => {
    renderAt('/app/ns/f/gone/d/doc-1');
    expect(screen.getByText('This folder was deleted or moved')).toBeTruthy();
    expect(screen.getByTestId('url').textContent).toBe('/app/ns/f/gone/d/doc-1');
  });

  it('opens an absent folder once this node syncs it', () => {
    // A fresh element each time, so rerender actually re-renders the layout.
    const tree = () => (
      <MemoryRouter initialEntries={['/app/ns/f/late']}>
        <Routes>
          <Route path="/app/*" element={<WorkspaceLayout />} />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(tree());
    expect(screen.getByText('This folder was deleted or moved')).toBeTruthy();
    workspace.registryFolders = [
      { id: 'late', parent_id: null, color: null, alias: 'Late' },
    ];
    workspace.resolvedFolderIds = new Set(['late']);
    rerender(tree());
    expect(screen.queryByText('This folder was deleted or moved')).toBeNull();
  });

  it('words the no-access card for a folder link', () => {
    workspace.hiddenFolderIds = new Set(['f1']);
    renderAt('/app/ns/f/f1');
    expect(screen.getByText('Finance is a restricted folder')).toBeTruthy();
  });

  it('says the docs failed to load and Try again re-reads them', () => {
    docs.listed = false;
    docs.error = new Error('docs down');
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.getByText("Couldn't load this folder's documents")).toBeTruthy();
    expect(screen.queryByText('Syncing workspace from peers…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(docsRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the post-join copy for a workspace still syncing after a join', () => {
    workspace.isJustJoined = true;
    workspace.resolvedFolderIds = new Set();
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.getByText('Syncing workspace from peers…')).toBeTruthy();
  });

  it('shows a plain error with Try again when the workspace list fails', () => {
    workspace.namespacesListed = false;
    workspace.namespacesError = new Error('HTTP 500 Internal Server Error');
    renderAt('/app/ns');
    expect(screen.getByText("Couldn't load your workspaces")).toBeTruthy();
    expect(screen.queryByText(/HTTP 500/)).toBeNull();
    expect(screen.queryByTestId('home')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(workspaceRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps Home when a later workspace list read fails', () => {
    workspace.namespacesListed = true;
    workspace.namespacesError = new Error('node unreachable');
    renderAt('/app/ns');
    expect(screen.getByTestId('home')).toBeTruthy();
    expect(screen.queryByText("Couldn't load your workspaces")).toBeNull();
  });

  it('keeps the name gate mounted through a failed list re-read', () => {
    workspace.namespacesListed = true;
    workspace.namespacesError = new Error('node unreachable');
    renderAt('/app/ns');
    expect(screen.getByTestId('name-gate')).toBeTruthy();
  });

  it('shows a docs failure ahead of the post-join syncing copy', () => {
    workspace.isJustJoined = true;
    docs.listed = false;
    docs.error = new Error('docs down');
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.getByText("Couldn't load this folder's documents")).toBeTruthy();
    expect(screen.queryByText('Syncing workspace from peers…')).toBeNull();
  });

  it('never mounts the name gate for a workspace this node is not in', () => {
    workspace.namespaces = [{ namespaceId: 'other' }];
    renderAt('/app/ns');
    expect(screen.queryByTestId('name-gate')).toBeNull();
  });

  it('never mounts the name gate before membership is known', () => {
    workspace.namespacesListed = false;
    renderAt('/app/ns');
    expect(screen.queryByTestId('name-gate')).toBeNull();
  });

  it('mounts the name gate for a workspace the caller is in', () => {
    renderAt('/app/ns');
    expect(screen.getByTestId('name-gate')).toBeTruthy();
  });
});
