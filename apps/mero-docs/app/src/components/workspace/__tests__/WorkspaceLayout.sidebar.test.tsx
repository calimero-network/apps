import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import {
  BrowserRouter,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { WorkspaceLayout } from '../WorkspaceLayout';

const setSelectedFolder = vi.fn();
// The real hook reads the selected folder from the URL too.
vi.mock('@/hooks/useDriveWorkspace', async () => {
  const { useAppRoute } = await import('@/hooks/useAppRoute');
  return {
    useDriveWorkspace: () => ({
      namespaceId: 'ns',
      registryContextId: 'reg',
      selectedFolderId: useAppRoute().route?.folder ?? null,
      setSelectedFolder,
      folders: [],
      selfIdentity: 'me',
      stage: 'ready',
      syncStatus: null,
      refetch: vi.fn(),
    }),
  };
});
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
vi.mock('../NamespaceSettingsPanel', () => ({
  NamespaceSettingsPanel: () => <div data-testid="settings-panel" />,
}));
vi.mock('@/components/docs/DocumentEditor', () => ({
  DocumentEditor: ({
    folderId,
    docId,
    onClose,
    onDeleted,
  }: {
    folderId: string;
    docId: string;
    onClose: () => void;
    onDeleted: () => void;
  }) => (
    <div>
      <div data-testid="editor">{`${folderId}/${docId}`}</div>
      <button onClick={onClose}>Back to folder</button>
      <button onClick={onDeleted}>Delete doc</button>
    </div>
  ),
}));
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

function Url() {
  const l = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="url">{l.pathname + l.search + l.hash}</output>
      <button onClick={() => navigate(-1)}>History back</button>
    </>
  );
}

function renderAt(...entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
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

const url = () => screen.getByTestId('url').textContent;

// Settings close reads the browser's own history index, which MemoryRouter never writes.
function renderInBrowser(path: string, state: unknown = {}) {
  window.history.replaceState({}, '', '/prior');
  window.history.pushState(state, '', path);
  return render(
    <BrowserRouter>
      <Routes>
        <Route path="/app/*" element={<WorkspaceLayout />} />
      </Routes>
    </BrowserRouter>,
  );
}

type MediaChange = (e: { matches: boolean }) => void;
let mediaListeners: MediaChange[] = [];

// jsdom has no matchMedia; the layout switches to the drawer below md.
function setDesktop(matches: boolean) {
  mediaListeners = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: (_: string, cb: MediaChange) => mediaListeners.push(cb),
    removeEventListener: vi.fn(),
  }));
}

function resizeTo(desktop: boolean) {
  act(() => mediaListeners.forEach((cb) => cb({ matches: desktop })));
}

afterEach(() => {
  localStorage.clear();
  setSelectedFolder.mockClear();
});

describe('WorkspaceLayout sidebar below md', () => {
  it('starts hidden and opens as a drawer from the top-bar toggle', () => {
    setDesktop(false);
    renderAt('/app/ns');
    expect(screen.queryByRole('button', { name: 'Pick folder' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    const drawer = screen.getByRole('dialog', { name: 'Folders' });
    expect(drawer).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pick folder' })).toBeTruthy();
  });

  it('closes after choosing a folder', async () => {
    setDesktop(false);
    renderAt('/app/ns');
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Pick folder' }));

    expect(setSelectedFolder).toHaveBeenCalledWith('f1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes after choosing a document', async () => {
    setDesktop(false);
    renderAt('/app/ns');
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Pick doc' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on Escape', async () => {
    setDesktop(false);
    renderAt('/app/ns');
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes from its own close button', async () => {
    setDesktop(false);
    renderAt('/app/ns');
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    const drawer = screen.getByRole('dialog', { name: 'Folders' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not reopen the drawer after a round trip through a wide screen', () => {
    setDesktop(false);
    renderAt('/app/ns');
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    resizeTo(true);
    resizeTo(false);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores a collapse saved on a wide screen', () => {
    setDesktop(false);
    localStorage.setItem('mero-sidebar-collapsed', 'true');
    renderAt('/app/ns');

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));

    expect(screen.getByRole('dialog', { name: 'Folders' })).toBeTruthy();
  });
});

describe('WorkspaceLayout sidebar at md and up', () => {
  it('renders inline and the toggle collapses it', () => {
    setDesktop(true);
    renderAt('/app/ns');
    expect(screen.getByRole('button', { name: 'Pick folder' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));

    expect(screen.queryByRole('button', { name: 'Pick folder' })).toBeNull();
  });

  it('stays open after choosing a folder', () => {
    setDesktop(true);
    renderAt('/app/ns');

    fireEvent.click(screen.getByRole('button', { name: 'Pick folder' }));

    expect(screen.getByRole('button', { name: 'Pick folder' })).toBeTruthy();
  });
});

describe('WorkspaceLayout screens come from the URL', () => {
  it('opens the doc a URL names', async () => {
    setDesktop(true);
    renderAt('/app/ns/f/f1/d/doc-2');
    expect((await screen.findByTestId('editor')).textContent).toBe('f1/doc-2');
  });

  it('opens a doc at its own URL', () => {
    setDesktop(true);
    renderAt('/app/ns');
    fireEvent.click(screen.getByRole('button', { name: 'Pick doc' }));
    expect(url()).toBe('/app/ns/f/f1/d/d1');
  });

  it('shows settings at their URL and closing returns to the previous screen', async () => {
    setDesktop(true);
    renderInBrowser('/app/ns/f/f1');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(window.location.pathname).toBe('/app/ns/settings');
    expect(screen.getByTestId('settings-panel')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(window.location.pathname).toBe('/app/ns/f/f1'));
    expect(screen.queryByTestId('settings-panel')).toBeNull();
  });

  it('closes settings opened cold to the workspace Home', () => {
    setDesktop(true);
    renderInBrowser('/app/ns/settings');
    expect(screen.getByTestId('settings-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(window.location.pathname).toBe('/app/ns');
  });

  // Signing in replaces the landing entry with the saved link, so the settings
  // entry has a router key but nothing of this app behind it.
  it('closes settings reached by a replace on the first entry to Home', async () => {
    setDesktop(true);
    renderInBrowser('/app/ns/settings', { usr: null, key: 'signin', idx: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(window.location.pathname).toBe('/app/ns'));
  });

  it('after deleting the open doc, back skips the deleted doc', () => {
    setDesktop(true);
    renderAt('/app/ns', '/app/ns/f/f1/d/doc-2');
    fireEvent.click(screen.getByRole('button', { name: 'Delete doc' }));
    expect(url()).toBe('/app/ns/f/f1');
    fireEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(url()).toBe('/app/ns');
  });

  it('the editor back button is its own history entry', () => {
    setDesktop(true);
    renderAt('/app/ns', '/app/ns/f/f1/d/doc-2');
    fireEvent.click(screen.getByRole('button', { name: 'Back to folder' }));
    expect(url()).toBe('/app/ns/f/f1');
    fireEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(url()).toBe('/app/ns/f/f1/d/doc-2');
  });
});
