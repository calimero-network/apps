import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { bindNodeShield } from '@calimero-apps/passkey/nodeShield';
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
vi.mock('@/calimero/react', async (importOriginal) => ({
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

const NODE = 'https://node-1.docs.example.net';
const client = {
  nodeUrl: NODE,
  verification: () => undefined,
  verify: () => new Promise(() => {}),
} as unknown as CalimeroClient;

let unbind: () => void;

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  unbind = bindNodeShield(client, 'Calimero Cloud test');
});

afterEach(() => {
  unbind();
  cleanup();
  localStorage.clear();
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/app/ns']}>
      <Routes>
        <Route path="/app/*" element={<WorkspaceLayout />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: ConfirmProvider },
  );
}

describe('WorkspaceLayout node shield', () => {
  it('places exactly one node shield in the header, and no floating one', () => {
    renderLayout();
    const header = screen.getByRole('banner');
    expect(within(header).getAllByTestId('node-shield')).toHaveLength(1);
    expect(screen.getAllByTestId('node-shield')).toHaveLength(1);
  });

  it('replaces the node URL row with the shield and an online signal', () => {
    renderLayout();
    expect(screen.queryByLabelText(/^Connected to/)).toBeNull();
    expect(screen.queryByText('http://node')).toBeNull();
    expect(
      within(screen.getByRole('banner')).getByRole('img', { name: 'Online' }),
    ).toBeTruthy();
  });
});
