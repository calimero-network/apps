import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { WorkspaceLayout } from '../WorkspaceLayout';

const setSelectedFolder = vi.fn();
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    registryContextId: 'reg',
    selectedFolderId: null,
    setSelectedFolder,
    folders: [],
    selfIdentity: 'me',
    stage: 'ready',
    syncStatus: null,
    refetch: vi.fn(),
  }),
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
  SelectFolderState: () => null,
}));
vi.mock('../DisplayNameGate', () => ({ DisplayNameGate: () => null }));
vi.mock('@/components/folders/FolderTree', () => ({
  FolderTree: ({
    onSelectFolder,
    onOpenDoc,
  }: {
    onSelectFolder: (id: string) => void;
    onOpenDoc: (folderId: string, docId: string) => void;
  }) => (
    <div>
      <button onClick={() => onSelectFolder('f1')}>Pick folder</button>
      <button onClick={() => onOpenDoc('f1', 'd1')}>Pick doc</button>
    </div>
  ),
}));

// jsdom has no matchMedia; the layout switches to the drawer below md.
function setDesktop(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  localStorage.clear();
  setSelectedFolder.mockClear();
});

describe('WorkspaceLayout sidebar below md', () => {
  it('starts hidden and opens as a drawer from the top-bar toggle', () => {
    setDesktop(false);
    render(<WorkspaceLayout />);
    expect(screen.queryByRole('button', { name: 'Pick folder' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    const drawer = screen.getByRole('dialog', { name: 'Folders' });
    expect(drawer).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pick folder' })).toBeTruthy();
  });

  it('closes after choosing a folder', async () => {
    setDesktop(false);
    render(<WorkspaceLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Pick folder' }));

    expect(setSelectedFolder).toHaveBeenCalledWith('f1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes after choosing a document', async () => {
    setDesktop(false);
    render(<WorkspaceLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Pick doc' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on Escape', async () => {
    setDesktop(false);
    render(<WorkspaceLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes from its own close button', async () => {
    setDesktop(false);
    render(<WorkspaceLayout />);
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    const drawer = screen.getByRole('dialog', { name: 'Folders' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ignores a collapse saved on a wide screen', () => {
    setDesktop(false);
    localStorage.setItem('mero-sidebar-collapsed', 'true');
    render(<WorkspaceLayout />);

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    expect(screen.getByRole('dialog', { name: 'Folders' })).toBeTruthy();
  });
});

describe('WorkspaceLayout sidebar at md and up', () => {
  it('renders inline and the toggle collapses it', () => {
    setDesktop(true);
    render(<WorkspaceLayout />);
    expect(screen.getByRole('button', { name: 'Pick folder' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));

    expect(screen.queryByRole('button', { name: 'Pick folder' })).toBeNull();
  });

  it('stays open after choosing a folder', () => {
    setDesktop(true);
    render(<WorkspaceLayout />);

    fireEvent.click(screen.getByRole('button', { name: 'Pick folder' }));

    expect(screen.getByRole('button', { name: 'Pick folder' })).toBeTruthy();
  });
});
