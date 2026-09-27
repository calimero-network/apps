// A routed folder/doc/workspace the caller can't open shows LinkTargetCard
// instead of silently dropping them on Home or hanging the editor.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WorkspaceLayout } from '../WorkspaceLayout';

const workspace = vi.hoisted(() => ({
  namespaces: [{ namespaceId: 'ns' }],
  namespacesLoading: false,
  isJustJoined: false,
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
}));
const useDocsSpy = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useDriveWorkspace', async () => {
  const { useAppRoute } = await import('@/hooks/useAppRoute');
  return {
    useDriveWorkspace: () => ({
      namespaceId: useAppRoute().route?.ws ?? null,
      namespaces: workspace.namespaces,
      namespacesLoading: workspace.namespacesLoading,
      isJustJoined: workspace.isJustJoined,
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
      refetch: vi.fn(),
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
      error: null,
      refetch: vi.fn(),
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
vi.mock('@/components/theme/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../NamespaceSwitcher', () => ({ NamespaceSwitcher: () => null }));
vi.mock('@/components/folders/NoFolderStates', () => ({
  SelectFolderState: () => <div data-testid="select-folder" />,
}));
vi.mock('../DisplayNameGate', () => ({ DisplayNameGate: () => null }));
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
  workspace.namespacesLoading = false;
  workspace.isJustJoined = false;
  workspace.registryFolders = [
    { id: 'f1', parent_id: null, color: null, alias: 'Finance' },
  ];
  workspace.resolvedFolderIds = new Set(['f1']);
  workspace.hiddenFolderIds = new Set();
  docs.list = [{ id: 'doc-1' }];
  docs.loading = false;
  docs.listed = true;
  docs.contextResolving = false;
});

describe('WorkspaceLayout: routed target the caller cannot open', () => {
  it('shows a not-in-workspace card for a workspace this node is not in', () => {
    workspace.namespaces = [{ namespaceId: 'other' }];
    renderAt('/app/ns');
    expect(screen.getByText('You are not in this workspace')).toBeTruthy();
    expect(screen.queryByTestId('select-folder')).toBeNull();
  });

  it('does not treat an empty, still-loading namespace list as not-in-workspace', () => {
    workspace.namespaces = [];
    workspace.namespacesLoading = true;
    renderAt('/app/ns');
    expect(screen.queryByText('You are not in this workspace')).toBeNull();
  });

  it('treats a genuinely empty namespace list (loaded) as not-in-workspace', () => {
    workspace.namespaces = [];
    workspace.namespacesLoading = false;
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

  it('shows syncing, not a premature no-access, while a folder’s access is unresolved', () => {
    workspace.resolvedFolderIds = new Set();
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.queryByText('This document is in Finance')).toBeNull();
    expect(
      screen.getByText('Syncing workspace from peers…'),
    ).toBeTruthy();
  });

  it('shows the doc-worded deleted card for an unknown doc in a real folder', () => {
    renderAt('/app/ns/f/f1/d/gone');
    expect(screen.getByText('This document was deleted or moved')).toBeTruthy();
  });

  it('opens the doc once it resolves', async () => {
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(await screen.findByTestId('editor')).toBeTruthy();
  });

  it('waits (shows syncing, never a premature deleted) while the folder list has not loaded', () => {
    workspace.registryFolders = null;
    renderAt('/app/ns/f/f1/d/doc-1');
    expect(screen.queryByText('This document was deleted or moved')).toBeNull();
    expect(screen.queryByTestId('editor')).toBeNull();
    expect(
      screen.getByText('Syncing workspace from peers…'),
    ).toBeTruthy();
  });

  it('keeps an open doc mounted through a later syncing pulse', async () => {
    const tree = (
      <MemoryRouter initialEntries={['/app/ns/f/f1/d/doc-1']}>
        <Routes>
          <Route path="/app/*" element={<WorkspaceLayout />} />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(tree);
    expect(await screen.findByTestId('editor')).toBeTruthy();
    // e.g. registryClient briefly churns identity mid-session.
    docs.listed = false;
    rerender(tree);
    expect(screen.getByTestId('editor')).toBeTruthy();
  });

  it('Go to Home on not-in-workspace leaves for /app, not this bad workspace', () => {
    workspace.namespaces = [{ namespaceId: 'other' }];
    renderAt('/app/ns');
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }));
    expect(screen.getByTestId('url').textContent).toBe('/app');
  });

  it('leaves a deleted folder for workspace Home instead of parking on the dead link', () => {
    renderAt('/app/ns/f/gone');
    expect(screen.getByTestId('url').textContent).toBe('/app/ns');
  });
});
