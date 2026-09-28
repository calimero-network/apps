import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WorkspaceNav } from '../WorkspaceNav';
import { row } from '@/lib/workspaceIndex/__tests__/row';

const rows = [
  row({ docId: 'a', tags: ['q3', 'design'] }),
  row({ docId: 'b', tags: ['design'] }),
  row({ docId: 'c', tags: ['q3'], archived: true }),
];
const tags = [
  { key: 'q3', name: 'Q3', color: '#3b82f6', deleted: false },
  { key: 'design', name: 'Design', color: '#8b5cf6', deleted: false },
  { key: 'unused', name: 'Unused', color: '#10b981', deleted: false },
];

const index = {
  rows,
  folders: [{ id: 'f1', name: 'One' }],
  foldersKnown: true,
  folderStatus: { f1: 'ready' } as Record<string, string>,
};
vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => index,
}));
const createTag = vi.fn();
let canManageTags = true;
vi.mock('@/hooks/useTags', async (importActual) => ({
  ...(await importActual<typeof import('@/hooks/useTags')>()),
  useTags: () => ({ tags, createTag }),
  useCanManageTags: () => canManageTags,
}));
vi.mock('@/components/folders/FolderTree', () => ({
  FolderTree: ({
    collapsed,
    onToggleCollapsed,
  }: {
    collapsed: boolean;
    onToggleCollapsed: () => void;
  }) => (
    <>
      <button aria-expanded={!collapsed} onClick={onToggleCollapsed}>
        Folders
      </button>
      <input aria-label="Folder name" />
    </>
  ),
}));

let search = '';
function Probe() {
  search = useLocation().search;
  return null;
}

function mount(url: string, ws = 'ws1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/app/:ws/*"
          element={
            <>
              <WorkspaceNav
                ws={ws}
                selectedDocId={null}
                onSelectFolder={() => {}}
                onOpenDoc={() => {}}
                onNavigate={() => {}}
              />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const section = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  localStorage.clear();
  canManageTags = true;
  createTag.mockReset();
  index.rows = rows;
  index.folderStatus = { f1: 'ready' };
  index.folders = [{ id: 'f1', name: 'One' }];
  index.foldersKnown = true;
});

describe('WorkspaceNav', () => {
  it('counts readable, unarchived docs for Home and each tag, busiest tag first', () => {
    mount('/app/ws1');
    expect(screen.getByRole('button', { name: 'Home, 2' })).toBeTruthy();
    const tagRows = screen
      .getAllByRole('button', { name: /^(Design|Q3|Unused), / })
      .map((b) => b.getAttribute('aria-label'));
    expect(tagRows).toEqual(['Design, 2', 'Q3, 1']);
  });

  it('opens a tag as Home filtered to it, and marks that row, not Home', () => {
    const { unmount } = mount('/app/ws1');
    expect(
      screen
        .getByRole('button', { name: 'Home, 2' })
        .getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Q3, 1' }));
    expect(search).toBe('?tag=q3');
    unmount();

    mount('/app/ws1?tag=q3');
    expect(
      screen
        .getByRole('button', { name: 'Q3, 1' })
        .getAttribute('aria-current'),
    ).toBe('page');
    const home = screen.getByRole('button', { name: 'Home, 2' });
    expect(home.getAttribute('aria-current')).toBeNull();
  });

  it('marks nothing inside a folder', () => {
    mount('/app/ws1/f/f1');
    const home = screen.getByRole('button', { name: 'Home, 2' });
    expect(home.getAttribute('aria-current')).toBeNull();
  });

  it('offers New tag to editors and above, never to a guest, and no New view yet (T-18)', () => {
    const { unmount } = mount('/app/ws1');
    expect(screen.getByRole('button', { name: 'New tag' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New view' })).toBeNull();
    unmount();

    canManageTags = false;
    mount('/app/ws1');
    expect(screen.queryByRole('button', { name: 'New tag' })).toBeNull();
  });

  it('creates a tag with no document from the sidebar, then opens its page', async () => {
    const user = userEvent.setup();
    createTag.mockResolvedValue('launch');
    mount('/app/ws1');
    await user.click(screen.getByRole('button', { name: 'New tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'New tag' });
    expect(
      (within(dialog).getByRole('radio', { name: 'Blue' }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Launch');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(createTag).toHaveBeenCalledWith('Launch', '#f59e0b');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(search).toBe('?tag=launch');
  });

  it('refuses a name another tag has, in the dialog', async () => {
    const user = userEvent.setup();
    mount('/app/ws1');
    await user.click(screen.getByRole('button', { name: 'New tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'New tag' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' q3 ');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(
      within(dialog).getByText('A tag with this name already exists'),
    ).toBeTruthy();
    expect(createTag).not.toHaveBeenCalled();
  });

  it('keeps the dialog open when creating fails', async () => {
    const user = userEvent.setup();
    createTag.mockRejectedValue(new Error('down'));
    mount('/app/ws1');
    await user.click(screen.getByRole('button', { name: 'New tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'New tag' });
    const field = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.type(field, 'q3');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await within(dialog).findByText('A tag with this name already exists');
    await user.clear(field);
    await user.type(field, 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createTag).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        within(dialog).queryByText('A tag with this name already exists'),
      ).toBeNull(),
    );
    expect(screen.getByRole('dialog', { name: 'New tag' })).toBeTruthy();
    expect(search).toBe('');
  });

  it('remembers collapsed sections per workspace', () => {
    const { unmount } = mount('/app/ws1');
    fireEvent.click(section('Tags'));
    fireEvent.click(section('Folders'));
    expect(screen.queryByRole('button', { name: 'Q3, 1' })).toBeNull();
    unmount();

    const view = mount('/app/ws1');
    expect(section('Tags').getAttribute('aria-expanded')).toBe('false');
    expect(section('Folders').getAttribute('aria-expanded')).toBe('false');
    expect(section('Views').getAttribute('aria-expanded')).toBe('true');
    view.unmount();

    mount('/app/ws2', 'ws2');
    expect(section('Tags').getAttribute('aria-expanded')).toBe('true');
  });

  it('shows no Home count until every folder has been read', () => {
    index.folderStatus = { f1: 'loading' };
    const { unmount } = mount('/app/ws1');
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    unmount();

    // Between the folder list landing and its access checks, no folder is shown yet.
    index.foldersKnown = false;
    index.folders = [];
    index.rows = [];
    index.folderStatus = {};
    const view = mount('/app/ws1');
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    view.unmount();

    index.foldersKnown = true;
    index.folders = [{ id: 'f1', name: 'One' }];
    index.folderStatus = { f1: 'error' };
    mount('/app/ws1');
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
  });

  it('keeps the folder tree, and anything open in it, as new index data lands', async () => {
    const user = userEvent.setup();
    const { rerender } = mount('/app/ws1');
    const input = screen.getByRole('textbox', { name: 'Folder name' });
    input.focus();
    index.rows = [...rows, row({ docId: 'd', tags: ['q3'] })];
    index.folderStatus = { f1: 'loading' };
    rerender(
      <MemoryRouter initialEntries={['/app/ws1']}>
        <Routes>
          <Route
            path="/app/:ws/*"
            element={
              <WorkspaceNav
                ws="ws1"
                selectedDocId={null}
                onSelectFolder={() => {}}
                onOpenDoc={() => {}}
                onNavigate={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('textbox', { name: 'Folder name' })).toBe(input);
    await user.keyboard('x'); // lands in the field only if it kept focus
    expect((input as HTMLInputElement).value).toBe('x');
  });
});
