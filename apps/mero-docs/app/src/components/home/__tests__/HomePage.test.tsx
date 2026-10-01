// The index, tags, presence and permissions are faked; routing is real, so a
// test reads the URL a filter wrote and how it was written (push or replace).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';
import { HomePage } from '../HomePage';
import type { IndexRow } from '@/lib/workspaceIndex/types';
import type { FolderIndexStatus } from '@/hooks/useWorkspaceIndex';
import { row } from '@/lib/workspaceIndex/__tests__/row';
import { useAppRoute } from '@/hooks/useAppRoute';
import { TagNameTakenError } from '@/hooks/useTags';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 28, 15, 0).getTime();

const FOLDERS = [
  { id: 'eng', name: 'Engineering', color: '#10b981' },
  { id: 'specs', name: 'Specs', parentId: 'eng' },
  { id: 'design', name: 'Design', color: '#8b5cf6' },
];
const refetchFolder = vi.fn();
const create = vi.fn(async () => 'new-doc');
const index = {
  rows: [] as IndexRow[],
  folders: FOLDERS as {
    id: string;
    name: string;
    parentId?: string;
    color?: string;
  }[],
  foldersKnown: true,
  folderStatus: {} as Record<string, FolderIndexStatus>,
  contextOf: (id: string) => `ctx-${id}`,
  // No node index here: the filter reads the texts this device holds.
  clientOf: (_id: string) => undefined,
  refetchFolder,
};
const tags = [
  { key: 'q3', name: 'Q3', color: '#3b82f6', deleted: false },
  { key: 'gone', name: 'Gone', color: '#ef4444', deleted: true },
  { key: 'fresh', name: 'Fresh', color: '#10b981', deleted: false },
];
let presence = new Map<
  string,
  { id: string; name: string; colour: string }[]
>();
let canEdit: Record<string, boolean> = {};
const ws = {
  namespaceId: 'ws1',
  rootGroupId: 'ws1',
  selfIdentity: 'me',
  namespaceMemberNames: { me: 'Ann', bob: 'Bob' } as Record<string, string>,
  namespaces: [{ namespaceId: 'ws1', name: 'Acme Product' }],
  registryFolders: [
    { id: 'legal', parent_id: 'ws1', color: null, alias: 'Legal' },
  ],
};

const mentionOf = (folderId: string, docId: string, member = 'me') => ({
  folderId,
  docId,
  blocks: [],
  links: [],
  mentions: [{ ws: 'ws1', member, blockId: 'b1', sentence: '' }],
});
const textIndex = {
  texts: new Map<string, ReturnType<typeof mentionOf>>(),
  foldersDone: 3,
  foldersTotal: 3,
  pending: [] as string[],
  failed: [] as string[],
};
vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => index,
  useTextIndexValue: () => textIndex,
}));
const renameTag = vi.fn();
const recolorTag = vi.fn();
const deleteTag = vi.fn();
vi.mock('@/hooks/useTags', async (importActual) => ({
  ...(await importActual<typeof import('@/hooks/useTags')>()),
  useTags: () => ({
    tags,
    byKey: new Map(tags.map((t) => [t.key, t])),
    renameTag,
    recolorTag,
    deleteTag,
  }),
}));
const confirm = vi.fn();
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => confirm,
}));
vi.mock('@/hooks/usePresenceByDoc', () => ({
  usePresenceByDoc: () => presence,
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ws,
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: () => ({ name: null }),
}));
const saveView = vi.fn();
vi.mock('@/hooks/useSavedViews', () => ({
  useSavedViews: () => ({ views: [], save: saveView, rename: vi.fn(), remove: vi.fn() }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: (_ns: string, folderId: string) => ({
    canEditDocs: !!canEdit[folderId],
    loading: false,
    roleLoading: false,
    error: permError,
    roleError: null,
  }),
}));
let permError: Error | null = null;
let nsPerms: {
  canCreateFolder: boolean;
  loading: boolean;
  error?: Error | null;
} = { canCreateFolder: true, loading: false };
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => nsPerms,
}));
vi.mock('@/hooks/useDocs', () => ({
  useDocs: () => ({ contextId: 'ctx', create, error: null }),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));
vi.mock('@/components/folders/NewFolderDialog', () => ({
  NewFolderDialog: () => <div role="dialog" aria-label="New folder" />,
}));

let location = { pathname: '', search: '' };
let navType = '';
let navigate: (to: string) => void = () => {};
function LocationProbe() {
  const l = useLocation();
  navigate = useNavigate();
  location = { pathname: l.pathname, search: l.search };
  navType = useNavigationType();
  return null;
}

// The folder comes from the URL, as in the layout, so leaving a folder route unmounts its scope.
function RoutedHome() {
  const { route } = useAppRoute();
  return <HomePage folderId={route?.folder} />;
}

function mount(url = '/app/ws1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/app/:ws/*"
          element={
            <>
              <RoutedHome />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function settle(rows: IndexRow[]) {
  index.rows = rows;
  index.folderStatus = Object.fromEntries(
    index.folders.map((f) => [f.id, 'ready' as FolderIndexStatus]),
  );
  index.foldersKnown = true;
}

const ROWS = [
  row({
    folderId: 'specs',
    docId: 'd1',
    title: 'API spec',
    tags: ['q3', 'mystery', 'gone'],
    updatedAt: NOW - 2 * 60_000,
    createdAt: NOW - 3 * DAY,
    createdBy: 'bob',
  }),
  row({
    folderId: 'design',
    docId: 'd2',
    title: 'Brand',
    updatedAt: NOW - 3 * DAY,
    createdAt: NOW - DAY,
    createdBy: 'me',
  }),
  row({ folderId: 'eng', docId: 'd3', title: '', updatedAt: NOW - 10 * DAY }),
  row({ folderId: 'eng', docId: 'd4', title: 'Old plan', archived: true }),
];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  refetchFolder.mockClear();
  create.mockClear();
  presence = new Map();
  canEdit = {};
  saveView.mockReset();
  renameTag.mockReset().mockResolvedValue(undefined);
  recolorTag.mockReset().mockResolvedValue(undefined);
  deleteTag.mockReset().mockResolvedValue(undefined);
  confirm.mockReset().mockResolvedValue(true);
  nsPerms = { canCreateFolder: true, loading: false };
  permError = null;
  index.folders = FOLDERS;
  settle(ROWS);
  textIndex.texts = new Map(
    [mentionOf('design', 'd2'), mentionOf('specs', 'd1', 'bob')].map((t) => [
      `${t.folderId}/${t.docId}`,
      t,
    ]),
  );
  textIndex.foldersDone = 3;
  textIndex.failed = [];
});

afterEach(() => vi.useRealTimers());

function titles() {
  return screen.queryAllByTestId('doc-title').map((el) => el.textContent);
}

function chip(name: RegExp) {
  return screen.getByRole('button', { name });
}

describe('HomePage', () => {
  it('lists readable, unarchived docs newest first, named across their folders', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(screen.getByText('3 documents across 3 folders')).toBeTruthy();
    expect(titles()).toEqual(['API spec', 'Brand', 'Untitled']);
    const api = screen.getByRole('link', { name: 'API spec' });
    expect(api.textContent).toContain('Engineering / Specs');
    expect(within(api).getAllByText('2 min ago')[0]).toBeTruthy();
  });

  it('names tags from the registry, shows an unknown key as itself, hides a deleted one', () => {
    mount();
    const api = screen.getByRole('link', { name: 'API spec' });
    expect(within(api).getByText('Q3')).toBeTruthy();
    expect(within(api).getByText('mystery')).toBeTruthy();
    expect(within(api).queryByText('Gone')).toBeNull();
  });

  it('says who is here on a row', () => {
    presence = new Map([
      ['specs/d1', [{ id: 'n', name: 'Bob', colour: '#f00' }]],
    ]);
    mount();
    const api = screen.getByRole('link', { name: 'API spec' });
    expect(within(api).getByText('Bob is here')).toBeTruthy();
  });

  it('scopes a folder route to that folder and its subfolders, under its name', () => {
    mount('/app/ws1/f/eng');
    expect(screen.getByRole('heading', { name: 'Engineering' })).toBeTruthy();
    expect(titles()).toEqual(['API spec', 'Untitled']);
    expect(screen.queryByRole('button', { name: /^Folder/ })).toBeNull();
  });

  describe('filters in the URL', () => {
    it('rewrites a messy URL to its canonical form without a history entry', () => {
      mount('/app/ws1?sort=bogus&tag=q3&tag=q3&junk=1');
      expect(location.search).toBe('?tag=q3');
      expect(navType).toBe('REPLACE');
    });

    it('keeps the dev node param while canonicalising', () => {
      mount('/app/ws1?node=2&tag=q3');
      expect(location.search).toBe('?node=2&tag=q3');
      expect(navType).toBe('POP');
    });

    it('reads a pasted filter URL into the same list', () => {
      mount('/app/ws1?tag=q3&updated=7d');
      expect(titles()).toEqual(['API spec']);
      expect(screen.getByText('1 document matches')).toBeTruthy();
      expect(chip(/^Tag: Q3$/)).toBeTruthy();
    });

    it('writes a picked tag to the URL as a new history entry', () => {
      mount();
      fireEvent.click(chip(/^Tag$/));
      fireEvent.click(screen.getByRole('checkbox', { name: /Q3/ }));
      expect(location.search).toBe('?tag=q3');
      expect(navType).toBe('PUSH');
      expect(titles()).toEqual(['API spec']);
    });

    it('counts each folder with its subfolders', () => {
      mount();
      fireEvent.click(chip(/^Folder$/));
      const eng = screen.getByRole('checkbox', { name: /^Engineering\s*2$/ });
      expect(within(eng).getByText('2')).toBeTruthy();
      fireEvent.click(eng);
      expect(location.search).toBe('?folder=eng');
      expect(titles()).toEqual(['API spec', 'Untitled']);
    });

    it('filters by who created a doc, naming people, never keys', () => {
      mount();
      fireEvent.click(chip(/^Created by$/));
      expect(screen.getByRole('checkbox', { name: /^You/ })).toBeTruthy();
      fireEvent.click(screen.getByRole('checkbox', { name: /^Bob/ }));
      expect(location.search).toBe('?by=bob');
      expect(chip(/^Created by: Bob$/)).toBeTruthy();
    });

    it('closes the Updated menu after one pick', () => {
      mount();
      fireEvent.click(chip(/^Updated$/));
      fireEvent.click(screen.getByRole('radio', { name: 'Last 7 days' }));
      expect(location.search).toBe('?updated=7d');
      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(titles()).toEqual(['API spec', 'Brand']);
    });

    it('shows archived docs only while Archived is on', () => {
      mount();
      fireEvent.click(chip(/^Archived$/));
      expect(location.search).toBe('?archived=true');
      expect(titles()).toEqual(['Old plan']);
      fireEvent.click(chip(/^Folder$/));
      expect(
        screen.getByRole('checkbox', { name: /^Engineering\s*1$/ }),
      ).toBeTruthy();
    });

    it('turns Mentioned me on and off in the URL, listing the docs that mention you', () => {
      mount();
      fireEvent.click(chip(/^Mentioned me$/));
      expect(location.search).toBe('?mentions=me');
      expect(titles()).toEqual(['Brand']);
      fireEvent.click(chip(/^Mentioned me$/));
      expect(location.search).toBe('');
      expect(titles()).toHaveLength(3);
    });

    it('waits for the documents to be read before saying nothing mentions you', () => {
      textIndex.texts = new Map();
      textIndex.foldersDone = 1;
      const { unmount } = mount('/app/ws1?mentions=me');
      expect(
        screen.queryByText('No documents match these filters'),
      ).toBeNull();
      unmount();

      textIndex.foldersDone = 3;
      mount('/app/ws1?mentions=me');
      expect(
        screen.getByText('No documents match these filters'),
      ).toBeTruthy();
    });

    it('says which folders it could not fully read instead of claiming nothing mentions you', () => {
      textIndex.texts = new Map();
      textIndex.foldersDone = 2;
      textIndex.failed = ['design'];
      mount('/app/ws1?mentions=me');
      expect(
        screen.getByRole('heading', {
          name: 'No matches in the documents read so far',
        }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Some documents could not be read, so this list may be incomplete.',
        ),
      ).toBeTruthy();
      expect(
        screen.getByRole('status').textContent,
      ).toContain("Couldn't read every document in Design.");
      expect(screen.queryByText('No documents match these filters')).toBeNull();
      // The no-docs state, whose New document is the empty state's own action.
      expect(screen.queryByText('No documents yet')).toBeNull();
    });

    it('cycles the sort and keeps it in the URL', () => {
      mount();
      fireEvent.click(chip(/^Sort: Last updated$/));
      expect(location.search).toBe('?sort=name');
      expect(titles()).toEqual(['API spec', 'Brand', 'Untitled']);
      fireEvent.click(chip(/^Sort: Name$/));
      expect(location.search).toBe('?sort=created');
      expect(titles()).toEqual(['Brand', 'API spec', 'Untitled']);
    });

    it('names a folder this member cannot see by its alias, as the no-access card does', () => {
      mount('/app/ws1?folder=legal');
      expect(chip(/^Folder: Legal$/)).toBeTruthy();
      cleanup();
      mount('/app/ws1?folder=nope');
      expect(chip(/^Unknown folder$/)).toBeTruthy();
    });

    it('names an unknown tag and offers to clear the filters', () => {
      mount('/app/ws1?tag=nope');
      expect(chip(/^Unknown tag$/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(location.search).toBe('');
      expect(titles()).toHaveLength(3);
    });
  });

  describe('empty and partial states', () => {
    it('offers a first folder when there are none', () => {
      index.folders = [];
      settle([]);
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
      expect(screen.getByRole('dialog', { name: 'New folder' })).toBeTruthy();
    });

    it('tells read-only members an owner has to create or share a folder', () => {
      nsPerms = { canCreateFolder: false, loading: false };
      index.folders = [];
      settle([]);
      mount();
      expect(
        screen.getByText(/owner needs to create one or share one with you/),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    });

    it('holds the body copy until permissions are known', () => {
      nsPerms = { canCreateFolder: false, loading: true };
      index.folders = [];
      settle([]);
      mount();
      expect(screen.getByText('No folders yet')).toBeTruthy();
      expect(screen.queryByText(/Documents live in folders/)).toBeNull();
      expect(screen.queryByText(/owner needs to create/)).toBeNull();
    });

    it('treats a failed permission read as unknown, never as read only', () => {
      nsPerms = {
        canCreateFolder: false,
        loading: false,
        error: new Error('502'),
      };
      index.folders = [];
      settle([]);
      const { unmount } = mount();
      expect(screen.getByText('No folders yet')).toBeTruthy();
      expect(screen.queryByText(/owner needs to create/)).toBeNull();
      unmount();

      index.folders = FOLDERS;
      settle([]);
      permError = new Error('502');
      mount('/app/ws1/f/design');
      expect(screen.getByText('No documents yet')).toBeTruthy();
      expect(screen.queryByText(/They show up here/)).toBeNull();
    });

    it('speaks about the folder on an empty folder route, by role', () => {
      settle([]);
      canEdit = { design: true };
      const { unmount } = mount('/app/ws1/f/design');
      expect(screen.getByText('No documents in this folder yet.')).toBeTruthy();
      expect(screen.queryByText(/in every folder/)).toBeNull();
      unmount();

      canEdit = {};
      mount('/app/ws1/f/design');
      expect(
        screen.getByText(
          'No documents in this folder yet. They show up here when someone adds one.',
        ),
      ).toBeTruthy();
    });

    it('says there are no documents only once every folder has been read', () => {
      settle([]);
      index.folderStatus.design = 'loading';
      const { unmount } = mount();
      expect(screen.queryByText('No documents yet')).toBeNull();
      unmount();

      settle([]);
      mount();
      expect(screen.getByText('No documents yet')).toBeTruthy();
    });

    it('waits for the folder list before saying anything', () => {
      index.folders = [];
      settle([]);
      index.foldersKnown = false;
      mount();
      expect(screen.queryByText('No folders yet')).toBeNull();
      expect(screen.queryByText('No documents yet')).toBeNull();
    });

    it('claims no count while a folder is still loading', () => {
      index.folderStatus.design = 'loading';
      mount();
      expect(titles().length).toBeGreaterThan(0);
      expect(screen.queryByText(/documents? across/)).toBeNull();
    });

    it('claims nothing when every folder failed or is syncing and nothing was read', () => {
      settle([]);
      index.folderStatus = { eng: 'error', specs: 'error', design: 'syncing' };
      mount();
      expect(screen.queryByText('No documents yet')).toBeNull();
      expect(screen.queryByText('0 documents')).toBeNull();
      expect(screen.getByText(/Couldn't load/)).toBeTruthy();
    });

    it('names a folder still syncing, and retries one that failed', () => {
      index.folderStatus.design = 'syncing';
      index.folderStatus.eng = 'error';
      mount();
      expect(screen.getByText(/Still syncing Design/)).toBeTruthy();
      expect(screen.getByText(/Couldn't load Engineering/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(refetchFolder).toHaveBeenCalledWith('eng');
    });
  });

  describe('new document', () => {
    it('creates straight away in the only folder you can write to', async () => {
      canEdit = { design: true };
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'New document' }));
      await waitFor(() =>
        expect(location.pathname).toBe('/app/ws1/f/design/d/new-doc'),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(create).toHaveBeenCalledWith({ title: 'Untitled' });
    });

    it('asks which folder when you can write to several', async () => {
      canEdit = { design: true, eng: true };
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'New document' }));
      const picker = screen.getByRole('dialog', { name: 'New document in…' });
      fireEvent.click(within(picker).getByRole('button', { name: 'Design' }));
      await waitFor(() =>
        expect(location.pathname).toBe('/app/ws1/f/design/d/new-doc'),
      );
    });

    it('says plainly when the create fails, and lets you try again', async () => {
      canEdit = { design: true };
      create.mockRejectedValueOnce(new Error('HTTP 500: internal'));
      mount();
      const button = screen.getByRole('button', { name: 'New document' });
      fireEvent.click(button);
      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(
          "Couldn't create a document. Try again.",
        ),
      );
      expect((button as HTMLButtonElement).disabled).toBe(false);
      expect(location.pathname).toBe('/app/ws1');
    });

    it('offers New document once in an empty list', () => {
      canEdit = { design: true };
      settle([]);
      mount();
      expect(
        screen.getAllByRole('button', { name: 'New document' }),
      ).toHaveLength(1);
      expect(screen.getByText('No documents yet')).toBeTruthy();
    });

    it('creates in the routed folder, never asking about its subfolders', async () => {
      canEdit = { eng: true, specs: true };
      mount('/app/ws1/f/eng');
      fireEvent.click(screen.getByRole('button', { name: 'New document' }));
      await waitFor(() =>
        expect(location.pathname).toBe('/app/ws1/f/eng/d/new-doc'),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('offers no New document without a folder you can write to', () => {
      mount();
      expect(screen.queryByRole('button', { name: 'New document' })).toBeNull();
    });
  });

  describe('tag page', () => {
    const TAGGED = [
      ...ROWS,
      row({ folderId: 'design', docId: 'd5', title: 'Logo', tags: ['q3'] }),
    ];
    const heading = () => screen.getByRole('heading', { level: 1 });

    it('titles Home filtered to one tag with that tag, counting docs and folders (T-20)', () => {
      settle(TAGGED);
      mount('/app/ws1?tag=q3');
      expect(heading().textContent).toBe('Q3');
      expect(screen.getByText('2 documents in 2 folders')).toBeTruthy();
      expect(titles()).toEqual(['API spec', 'Logo']);
      expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
    });

    it('is plain Home once another filter narrows it, or for a tag it cannot name (T-21)', () => {
      settle(TAGGED);
      const { unmount } = mount('/app/ws1?tag=q3&updated=7d');
      expect(heading().textContent).toBe('Home');
      unmount();

      mount('/app/ws1?tag=gone');
      expect(heading().textContent).toBe('Home');
      expect(chip(/^Unknown tag$/)).toBeTruthy();
      expect(screen.getByText('No documents match these filters')).toBeTruthy();
    });

    it('hides tag management from a guest (T-18)', () => {
      nsPerms = { canCreateFolder: false, loading: false };
      mount('/app/ws1?tag=q3');
      expect(heading().textContent).toBe('Q3');
      expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    });

    it('renames, keeping the dialog open on a taken name (T-11)', async () => {
      vi.useRealTimers();
      mount('/app/ws1?tag=q3');
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
      const field = await screen.findByRole('textbox', { name: 'Name' });
      renameTag.mockRejectedValueOnce(new TagNameTakenError());
      fireEvent.change(field, { target: { value: 'Plan' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(
        await screen.findByText('A tag with this name already exists'),
      ).toBeTruthy();
      expect(renameTag).toHaveBeenCalledWith('q3', 'Plan');

      fireEvent.change(field, { target: { value: 'Q3 plan' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(renameTag).toHaveBeenLastCalledWith('q3', 'Q3 plan');
    });

    it('keeps the rename dialog open when the save fails', async () => {
      vi.useRealTimers();
      renameTag
        .mockRejectedValueOnce(new TagNameTakenError())
        .mockRejectedValue(new Error('down'));
      mount('/app/ws1?tag=q3');
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
      const field = await screen.findByRole('textbox', { name: 'Name' });
      fireEvent.change(field, { target: { value: 'Plan' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText('A tag with this name already exists');
      fireEvent.change(field, { target: { value: 'Q4' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(renameTag).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(
          screen.queryByText('A tag with this name already exists'),
        ).toBeNull(),
      );
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('deletes after a destructive confirm, from folders you can edit, then goes Home (T-13)', async () => {
      canEdit = { specs: true, eng: true };
      settle(TAGGED);
      mount('/app/ws1?tag=q3');
      await openMore();
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete tag' }),
      );
      await waitFor(() => expect(deleteTag).toHaveBeenCalled());
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delete tag?',
          confirmLabel: 'Delete tag',
          destructive: true,
        }),
      );
      const [key, editable] = deleteTag.mock.calls[0];
      expect(key).toBe('q3');
      expect([...editable].sort()).toEqual(['eng', 'specs']);
      await waitFor(() => expect(location.search).toBe(''));
      expect(navType).toBe('REPLACE');
    });

    it('deletes nothing when the confirm is dismissed, and stays when the delete fails', async () => {
      confirm.mockResolvedValueOnce(false);
      mount('/app/ws1?tag=q3');
      await openMore();
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete tag' }),
      );
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(deleteTag).not.toHaveBeenCalled();

      deleteTag.mockRejectedValue(new Error('down'));
      await openMore();
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete tag' }),
      );
      await waitFor(() => expect(deleteTag).toHaveBeenCalled());
      expect(location.search).toBe('?tag=q3');
    });

    it('says a tag with no documents has none yet, with no action', () => {
      mount('/app/ws1?tag=fresh');
      expect(heading().textContent).toBe('Fresh');
      expect(screen.getByText('No documents yet')).toBeTruthy();
      expect(
        screen.getByRole('heading', { name: 'No documents have this tag yet' }),
      ).toBeTruthy();
      expect(
        screen.getByText('Add it from the Tags row at the top of a document.'),
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'Clear filters' }),
      ).toBeNull();
    });

    it('holds the header while a delete runs, so it cannot start twice', async () => {
      let finish!: () => void;
      deleteTag.mockReturnValue(new Promise<void>((r) => (finish = r)));
      mount('/app/ws1?tag=q3');
      await openMore();
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete tag' }),
      );
      await waitFor(() => expect(deleteTag).toHaveBeenCalledTimes(1));
      expect(screen.getByText('Deleting tag…')).toBeTruthy();
      const rename = screen.getByRole('button', { name: 'Rename' });
      const more = screen.getByRole('button', { name: 'More' });
      expect((rename as HTMLButtonElement).disabled).toBe(true);
      expect((more as HTMLButtonElement).disabled).toBe(true);
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
      expect(screen.queryByRole('menu')).toBeNull();

      finish();
      await waitFor(() => expect(location.search).toBe(''));
      expect(deleteTag).toHaveBeenCalledTimes(1);
    });

    it('lets the header go again when the delete fails', async () => {
      deleteTag.mockRejectedValue(new Error('down'));
      mount('/app/ws1?tag=q3');
      await openMore();
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete tag' }),
      );
      await waitFor(() => expect(deleteTag).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      expect(screen.queryByText('Deleting tag…')).toBeNull();
    });

    it('drops an open rename when another tag page opens', async () => {
      vi.useRealTimers();
      mount('/app/ws1?tag=q3');
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
      await screen.findByRole('dialog');
      act(() => navigate('/app/ws1?tag=fresh'));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(heading().textContent).toBe('Fresh');
    });
  });

  describe('Save view', () => {
    function saveSubmit() {
      return screen
        .getAllByRole('button', { name: /^Save view/ })
        .find((b) => b.getAttribute('type') === 'submit')!;
    }

    it('is not shown with no filter on', () => {
      mount();
      expect(screen.queryByRole('button', { name: 'Save view' })).toBeNull();
    });

    it('opens with the filters summarised, a default name and the workspace name', async () => {
      mount('/app/ws1?updated=7d');
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
      expect(
        (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement)
          .value,
      ).toBe('Last 7 days');
      expect(screen.getByText('Last 7 days')).toBeTruthy();
      expect(
        screen.getByRole('radio', { name: /Everyone in Acme Product/ }),
      ).toBeTruthy();
    });

    it('disables sharing for a viewer without workspace caps', () => {
      nsPerms = { canCreateFolder: false, loading: false };
      mount('/app/ws1?updated=7d');
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
      expect(
        (
          screen.getByRole('radio', {
            name: /Everyone in Acme Product/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });

    it('saves as a personal view and selects it, replacing the history entry', async () => {
      saveView.mockResolvedValue({
        id: 'v1',
        name: 'Last 7 days',
        query: 'updated=7d',
        scope: 'me',
      });
      mount('/app/ws1?updated=7d');
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
      fireEvent.click(saveSubmit());
      await waitFor(() =>
        expect(saveView).toHaveBeenCalledWith('Last 7 days', 'updated=7d', 'me'),
      );
      await waitFor(() => expect(location.search).toBe('?updated=7d&view=v1'));
      expect(navType).toBe('REPLACE');
      expect(
        screen.queryByRole('textbox', { name: 'Name' }),
      ).toBeNull();
    });

    it('saves as a shared view when Everyone is picked', async () => {
      saveView.mockResolvedValue({
        id: 'v2',
        name: 'Last 7 days',
        query: 'updated=7d',
        scope: 'everyone',
      });
      mount('/app/ws1?updated=7d');
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
      fireEvent.click(
        screen.getByRole('radio', { name: /Everyone in Acme Product/ }),
      );
      fireEvent.click(saveSubmit());
      await waitFor(() =>
        expect(saveView).toHaveBeenCalledWith(
          'Last 7 days',
          'updated=7d',
          'everyone',
        ),
      );
    });

    it('drops any already-selected view from the query before saving a new one', async () => {
      saveView.mockResolvedValue({
        id: 'v2',
        name: 'Last 7 days',
        query: 'updated=7d',
        scope: 'me',
      });
      mount('/app/ws1?updated=7d&view=v1');
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
      fireEvent.click(saveSubmit());
      await waitFor(() =>
        expect(saveView).toHaveBeenCalledWith('Last 7 days', 'updated=7d', 'me'),
      );
    });

    it('is offered on a single tag page and saves that tag', async () => {
      saveView.mockResolvedValue({
        id: 'v1',
        name: 'Q3',
        query: 'tag=q3',
        scope: 'me',
      });
      mount('/app/ws1?tag=q3');
      expect(screen.getByRole('heading', { name: 'Q3' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
      expect(
        (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement)
          .value,
      ).toBe('Q3');
      fireEvent.click(saveSubmit());
      await waitFor(() =>
        expect(saveView).toHaveBeenCalledWith('Q3', 'tag=q3', 'me'),
      );
      await waitFor(() => expect(location.search).toBe('?tag=q3&view=v1'));
    });

    it('keeps a folder route as the folder filter, and opens the view on Home', async () => {
      saveView.mockResolvedValue({
        id: 'v1',
        name: 'Engineering, Last 7 days',
        query: 'folder=eng&updated=7d',
        scope: 'me',
      });
      mount('/app/ws1/f/eng?updated=7d');
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
      expect(
        (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement)
          .value,
      ).toBe('Engineering, Last 7 days');
      fireEvent.click(saveSubmit());
      await waitFor(() =>
        expect(saveView).toHaveBeenCalledWith(
          'Engineering, Last 7 days',
          'folder=eng&updated=7d',
          'me',
        ),
      );
      await waitFor(() =>
        expect(location).toEqual({
          pathname: '/app/ws1',
          search: '?folder=eng&updated=7d&view=v1',
        }),
      );
      expect(navType).toBe('REPLACE');
    });

    it('keeps the popover open, and the URL put, when saving fails', async () => {
      saveView.mockRejectedValue(new Error('down'));
      mount('/app/ws1?updated=7d');
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
      fireEvent.click(saveSubmit());
      await waitFor(() => expect(saveView).toHaveBeenCalled());
      expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
      expect(location.search).toBe('?updated=7d');
    });
  });
});

async function openMore() {
  const more = screen.getByRole('button', { name: 'More' });
  fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
  await screen.findByRole('menu');
}
