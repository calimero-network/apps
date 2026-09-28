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
import type { SavedView } from '@/hooks/useSavedViews';

const rows = [
  row({ docId: 'a', tags: ['q3', 'design'] }),
  row({ docId: 'b', tags: ['design'] }),
  row({ docId: 'c', tags: ['q3'], archived: true }),
];
const TAGS = [
  { key: 'q3', name: 'Q3', color: '#3b82f6', deleted: false },
  { key: 'design', name: 'Design', color: '#8b5cf6', deleted: false },
  { key: 'unused', name: 'Unused', color: '#10b981', deleted: false },
];
let tags = TAGS;

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
  useTags: () => ({ tags, byKey: new Map(tags.map((t) => [t.key, t])), createTag }),
  useCanManageTags: () => canManageTags,
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaces: [
      { namespaceId: 'ws1', name: 'Acme Product' },
      { namespaceId: 'ws2', name: 'Other' },
    ],
    selfIdentity: 'me',
    namespaceMemberNames: {},
  }),
}));
let savedViews: SavedView[] = [];
const saveView = vi.fn();
const renameView = vi.fn();
const removeView = vi.fn();
vi.mock('@/hooks/useSavedViews', () => ({
  useSavedViews: () => ({
    views: savedViews,
    save: saveView,
    rename: renameView,
    remove: removeView,
  }),
}));
const confirm = vi.fn();
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => confirm,
}));
const copyLink = vi.fn();
vi.mock('@/lib/copyLink', () => ({ copyLink: (...args: unknown[]) => copyLink(...args) }));
const toastMessage = vi.fn();
vi.mock('sonner', () => ({ toast: { message: (m: string) => toastMessage(m) } }));
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

const DAY = 24 * 60 * 60 * 1000;
const section = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  localStorage.clear();
  canManageTags = true;
  createTag.mockReset();
  savedViews = [];
  saveView.mockReset();
  renameView.mockReset().mockResolvedValue(undefined);
  removeView.mockReset().mockResolvedValue(undefined);
  confirm.mockReset().mockResolvedValue(true);
  copyLink.mockReset();
  toastMessage.mockReset();
  tags = TAGS;
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

  it('offers New tag and New view to editors and above, never to a guest', () => {
    const { unmount } = mount('/app/ws1');
    expect(screen.getByRole('button', { name: 'New tag' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New view' })).toBeTruthy();
    unmount();

    canManageTags = false;
    mount('/app/ws1');
    expect(screen.queryByRole('button', { name: 'New tag' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New view' })).toBeNull();
  });

  describe('saved views', () => {
    it('lists views with live counts, shared ones marked, selected by the view id (R-24)', () => {
      savedViews = [
        { id: 'v1', name: 'Design week', query: 'tag=design', scope: 'me' },
        {
          id: 'v2',
          name: 'Q3 launch',
          query: 'tag=q3',
          scope: 'everyone',
          createdBy: 'bob',
        },
      ];
      mount('/app/ws1?tag=q3&view=v2');
      const views = screen.getByRole('region', { name: 'Views' });
      expect(
        within(views).getByRole('button', { name: 'Design week, 2' }),
      ).toBeTruthy();
      const q3Row = within(views).getByRole('button', {
        name: 'Q3 launch, shared with everyone, 1',
      });
      expect(q3Row.getAttribute('aria-current')).toBe('page');
    });

    it('is zero, not a crash, for a view whose filter no row carries any more (R-23)', () => {
      savedViews = [
        { id: 'v1', name: 'Stale', query: 'tag=deleted-tag', scope: 'me' },
      ];
      mount('/app/ws1');
      const views = screen.getByRole('region', { name: 'Views' });
      expect(
        within(views).getByRole('button', { name: 'Stale, 0' }),
      ).toBeTruthy();
    });

    it("counts a view as its list does, with a deleted tag's key still on a doc matching nothing (R-23)", () => {
      tags = [...TAGS, { key: 'old', name: 'Old', color: '#ef4444', deleted: true }];
      index.rows = [...rows, row({ docId: 'd', tags: ['old'] })];
      savedViews = [
        { id: 'v1', name: 'Old things', query: 'tag=old', scope: 'me' },
      ];
      mount('/app/ws1');
      const views = screen.getByRole('region', { name: 'Views' });
      expect(
        within(views).getByRole('button', { name: 'Old things, 0' }),
      ).toBeTruthy();
    });

    it('marks only the open view, not Home or the tag it filters on', () => {
      savedViews = [
        { id: 'v1', name: 'Q3 launch', query: 'tag=q3', scope: 'me' },
        { id: 'v2', name: 'By name', query: 'sort=name', scope: 'me' },
      ];
      const { unmount } = mount('/app/ws1?tag=q3&view=v1');
      expect(
        screen
          .getAllByRole('button')
          .filter((b) => b.getAttribute('aria-current'))
          .map((b) => b.getAttribute('aria-label')),
      ).toEqual(['Q3 launch, 1']);
      unmount();

      mount('/app/ws1?sort=name&view=v2');
      expect(
        screen
          .getAllByRole('button')
          .filter((b) => b.getAttribute('aria-current'))
          .map((b) => b.getAttribute('aria-label')),
      ).toEqual(['By name, 2']);
    });

    it("moves a view's count on Home's clock tick, not on every render", () => {
      const now = Date.now();
      vi.useFakeTimers({ now, toFake: ['Date'] });
      try {
        index.rows = [row({ docId: 'a', updatedAt: now - 7 * DAY + 30_000 })];
        savedViews = [
          { id: 'v1', name: 'This week', query: 'updated=7d', scope: 'me' },
        ];
        mount('/app/ws1');
        expect(
          screen.getByRole('button', { name: 'This week, 1' }),
        ).toBeTruthy();
        vi.setSystemTime(now + 45_000);
        fireEvent.click(section('Tags')); // any re-render
        expect(
          screen.getByRole('button', { name: 'This week, 1' }),
        ).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('opens a view at its stored query plus its own id', () => {
      savedViews = [
        { id: 'v1', name: 'Design week', query: 'tag=design', scope: 'me' },
      ];
      mount('/app/ws1');
      fireEvent.click(screen.getByRole('button', { name: 'Design week, 2' }));
      expect(search).toBe('?tag=design&view=v1');
    });

    it('shows a hint instead of the popover with no filter on', () => {
      mount('/app/ws1');
      fireEvent.click(screen.getByRole('button', { name: 'New view' }));
      expect(toastMessage).toHaveBeenCalledWith(
        'Turn on a filter to save it as a view.',
      );
    });

    it('opens the save popover from the section "+" itself, and returns focus there', async () => {
      const user = userEvent.setup();
      mount('/app/ws1?tag=q3');
      expect(screen.queryByRole('button', { name: 'Save view' })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'New view' }));
      await screen.findByRole('textbox', { name: 'Name' });
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull(),
      );
      await user.keyboard('{Enter}'); // reopens only if the "+" has focus
      expect(
        await screen.findByRole('textbox', { name: 'Name' }),
      ).toBeTruthy();
    });

    it('saves the current filters as a personal view from the section header', async () => {
      saveView.mockResolvedValue({
        id: 'new',
        name: 'Q3',
        query: 'tag=q3',
        scope: 'me',
      });
      mount('/app/ws1?tag=q3');
      fireEvent.click(screen.getByRole('button', { name: 'New view' }));
      const input = await screen.findByRole('textbox', { name: 'Name' });
      expect((input as HTMLInputElement).value).toBe('Q3');
      expect((input as HTMLInputElement).maxLength).toBe(60);
      fireEvent.click(
        screen
          .getAllByRole('button', { name: /^Save view/ })
          .find((b) => b.getAttribute('type') === 'submit')!,
      );
      await waitFor(() =>
        expect(saveView).toHaveBeenCalledWith('Q3', 'tag=q3', 'me'),
      );
      await waitFor(() => expect(search).toBe('?tag=q3&view=new'));
    });

    it('renames a view through its menu', async () => {
      const user = userEvent.setup();
      savedViews = [
        { id: 'v1', name: 'Design week', query: 'tag=design', scope: 'me' },
      ];
      mount('/app/ws1');
      await user.click(
        screen.getByRole('button', { name: 'Actions for Design week' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
      const input = await screen.findByRole('textbox', {
        name: 'Name',
        description: 'Up to 60 characters.',
      });
      expect((input as HTMLInputElement).maxLength).toBe(60);
      await user.clear(input);
      await user.type(input, 'Design this week{Enter}');
      expect(renameView).toHaveBeenCalledWith('v1', 'Design this week');
    });

    it('refuses a rename over the byte limit, however few the characters', async () => {
      const user = userEvent.setup();
      savedViews = [
        { id: 'v1', name: 'Design week', query: 'tag=design', scope: 'me' },
      ];
      mount('/app/ws1');
      await user.click(
        screen.getByRole('button', { name: 'Actions for Design week' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
      const input = await screen.findByRole('textbox', { name: 'Name' });
      await user.clear(input);
      await user.type(input, '🚀'.repeat(16)); // 32 UTF-16 units, 64 bytes
      expect(
        screen.getByRole('textbox', {
          name: 'Name',
          description: 'That name is too long.',
        }),
      ).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      await user.type(input, '{Enter}');
      expect(renameView).not.toHaveBeenCalled();
    });

    it('closes the save popover when its "+" is clicked again', async () => {
      mount('/app/ws1?tag=q3');
      const add = screen.getByRole('button', { name: 'New view' });
      fireEvent.click(add);
      await screen.findByRole('textbox', { name: 'Name' });
      fireEvent.click(add);
      await waitFor(() =>
        expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull(),
      );
    });

    it('copies an absolute link to a view', async () => {
      const user = userEvent.setup();
      savedViews = [
        { id: 'v1', name: 'Design week', query: 'tag=design', scope: 'me' },
      ];
      mount('/app/ws1');
      await user.click(
        screen.getByRole('button', { name: 'Actions for Design week' }),
      );
      await user.click(
        await screen.findByRole('menuitem', { name: 'Copy link' }),
      );
      expect(copyLink).toHaveBeenCalledWith(
        `${window.location.origin}/app/ws1?tag=design&view=v1`,
      );
    });

    it('deletes a view after a destructive confirm', async () => {
      const user = userEvent.setup();
      savedViews = [
        { id: 'v1', name: 'Design week', query: 'tag=design', scope: 'me' },
      ];
      mount('/app/ws1?tag=design&view=v1');
      await user.click(
        screen.getByRole('button', { name: 'Actions for Design week' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      await waitFor(() => expect(removeView).toHaveBeenCalledWith('v1'));
      expect(search).toBe('?tag=design');
    });

    it('does nothing when the delete confirm is dismissed', async () => {
      const user = userEvent.setup();
      confirm.mockResolvedValue(false);
      savedViews = [
        { id: 'v1', name: 'Design week', query: 'tag=design', scope: 'me' },
      ];
      mount('/app/ws1');
      await user.click(
        screen.getByRole('button', { name: 'Actions for Design week' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      expect(removeView).not.toHaveBeenCalled();
    });

    it('lets a guest manage their own personal view, but not a shared one (R-22)', () => {
      canManageTags = false;
      savedViews = [
        { id: 'v1', name: 'Mine', query: 'tag=design', scope: 'me' },
        { id: 'v2', name: 'Shared', query: 'tag=q3', scope: 'everyone' },
      ];
      mount('/app/ws1');
      expect(
        screen.getByRole('button', { name: 'Actions for Mine' }),
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'Actions for Shared' }),
      ).toBeNull();
    });
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
