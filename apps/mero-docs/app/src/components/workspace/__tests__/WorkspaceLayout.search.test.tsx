import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceLayout } from '../WorkspaceLayout';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

const setSelectedFolder = vi.fn();
// The real hook reads the selected folder from the URL too.
vi.mock('@/hooks/useDriveWorkspace', async () => {
  const { useAppRoute } = await import('@/hooks/useAppRoute');
  return {
    useDriveWorkspace: () => ({
      namespaceId: 'ns',
      namespaces: [{ namespaceId: 'ns' }],
      namespacesLoading: false,
      isJustJoined: false,
      registryContextId: 'reg',
      selectedFolderId: useAppRoute().route?.folder ?? null,
      setSelectedFolder,
      folders: [],
      registryFolders: [
        { id: 'f1', parent_id: null, color: null, alias: 'F1' },
      ],
      resolvedFolderIds: new Set(['f1']),
      hiddenFolderIds: new Set<string>(),
      selfIdentity: 'me',
      namespaceMemberNames: {},
      stage: 'ready',
      syncStatus: null,
      refetch: vi.fn(),
    }),
  };
});
// Every doc these tests route to resolves, so the link-target gate opens the
// (separately mocked) editor as before.
vi.mock('@/hooks/useDocs', () => ({
  useDocs: () => ({
    list: [{ id: 'doc-2' }, { id: 'd1' }],
    loading: false,
    listed: true,
    contextResolving: false,
    contextId: 'ctx',
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    edit: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    client: null,
  }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: () => ({ name: null }),
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
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => ({ loading: false, canCreateFolder: false }),
}));
// The layout's own screens are under test; the index has its own suite.
vi.mock('@/context/WorkspaceIndexContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/WorkspaceIndexContext')>()),
  WorkspaceIndexProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock('@/components/theme/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('../NamespaceSwitcher', () => ({ NamespaceSwitcher: () => null }));
vi.mock('@/components/home/HomePage', () => ({ HomePage: () => null }));
vi.mock('../DisplayNameGate', () => ({ DisplayNameGate: () => null }));
vi.mock('../NamespaceSettingsPanel', () => ({
  NamespaceSettingsPanel: () => null,
}));
// A stand-in with BlockNote's editor class, where Cmd+K belongs to the editor.
vi.mock('@/components/docs/DocumentEditor', () => ({
  DocumentEditor: () => (
    <div className="bn-editor">
      <div data-testid="editor" tabIndex={0} />
    </div>
  ),
}));
vi.mock('@/components/folders/FolderTree', () => ({ FolderTree: () => null }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/*" element={<WorkspaceLayout />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: ConfirmProvider },
  );
}

const palette = () => screen.queryByRole('dialog', { name: 'Search' });

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  localStorage.clear();
});

describe('WorkspaceLayout search', () => {
  it('opens the palette from the top-bar field', () => {
    renderAt('/app/ns');
    fireEvent.click(
      screen.getByRole('button', { name: 'Search docs, folders and tags' }),
    );
    expect(palette()).not.toBeNull();
  });

  it('toggles the palette on Cmd+K or Ctrl+K anywhere outside the editor', () => {
    renderAt('/app/ns');
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', metaKey: true });
    expect(palette()).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
    });
    expect(palette()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'K', code: 'KeyK', ctrlKey: true });
    expect(palette()).not.toBeNull();
  });

  it('reads the K key by its place, so any keyboard layout opens it', () => {
    renderAt('/app/ns');
    fireEvent.keyDown(document.body, { key: 'л', code: 'KeyK', ctrlKey: true });
    expect(palette()).not.toBeNull();
  });

  it('leaves Cmd+K to the editor, where it adds a link', async () => {
    renderAt('/app/ns/f/f1/d/d1');
    const editor = await screen.findByTestId('editor');
    const event = fireEvent.keyDown(editor, {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
    });
    expect(event).toBe(true);
    expect(palette()).toBeNull();
  });

  it('records an opened doc as recent for this workspace', async () => {
    renderAt('/app/ns/f/f1/d/d1');
    await screen.findByTestId('editor');
    expect(
      JSON.parse(localStorage.getItem('mero-drive:recent:ns') ?? '[]'),
    ).toEqual([{ folderId: 'f1', docId: 'd1', openedAt: expect.any(Number) }]);
  });
});
