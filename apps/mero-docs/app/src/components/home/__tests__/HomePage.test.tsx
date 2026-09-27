// The index, tags, presence and permissions are faked; routing is real, so a
// test reads the URL a filter wrote and how it was written (push or replace).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
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
  useNavigationType,
} from 'react-router-dom';
import { HomePage } from '../HomePage';
import type { IndexRow } from '@/lib/workspaceIndex/types';
import type { FolderIndexStatus } from '@/hooks/useWorkspaceIndex';
import { row } from '@/lib/workspaceIndex/__tests__/row';

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
  refetchFolder,
};
const tags = [
  { key: 'q3', name: 'Q3', color: '#3b82f6', deleted: false },
  { key: 'gone', name: 'Gone', color: '#ef4444', deleted: true },
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
};

vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => index,
}));
vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ tags, byKey: new Map(tags.map((t) => [t.key, t])) }),
}));
vi.mock('@/hooks/usePresenceByDoc', () => ({
  usePresenceByDoc: () => presence,
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ws,
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
function LocationProbe() {
  const l = useLocation();
  location = { pathname: l.pathname, search: l.search };
  navType = useNavigationType();
  return null;
}

function mount(url = '/app/ws1', folderId?: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/app/:ws/*"
          element={
            <>
              <HomePage folderId={folderId} />
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
  nsPerms = { canCreateFolder: true, loading: false };
  permError = null;
  index.folders = FOLDERS;
  settle(ROWS);
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
    mount('/app/ws1/f/eng', 'eng');
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
      mount('/app/ws1?tag=q3');
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

    it('cycles the sort and keeps it in the URL', () => {
      mount();
      fireEvent.click(chip(/^Sort: Last updated$/));
      expect(location.search).toBe('?sort=name');
      expect(titles()).toEqual(['API spec', 'Brand', 'Untitled']);
      fireEvent.click(chip(/^Sort: Name$/));
      expect(location.search).toBe('?sort=created');
      expect(titles()).toEqual(['Brand', 'API spec', 'Untitled']);
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
      mount('/app/ws1/f/design', 'design');
      expect(screen.getByText('No documents yet')).toBeTruthy();
      expect(screen.queryByText(/They show up here/)).toBeNull();
    });

    it('speaks about the folder on an empty folder route, by role', () => {
      settle([]);
      canEdit = { design: true };
      const { unmount } = mount('/app/ws1/f/design', 'design');
      expect(screen.getByText('No documents in this folder yet.')).toBeTruthy();
      expect(screen.queryByText(/in every folder/)).toBeNull();
      unmount();

      canEdit = {};
      mount('/app/ws1/f/design', 'design');
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
      mount('/app/ws1/f/eng', 'eng');
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
});
