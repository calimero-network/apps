import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { FolderIndexStatus } from '@/hooks/useWorkspaceIndex';
import type { TextIndex } from '@/hooks/useTextIndex';
import type { RecentDoc } from '@/hooks/useRecentDocs';
import type { Block } from '@/generated/docs/DocsClient';
import { docTextFromBlocks, searchText } from '@/lib/search/docText';
import {
  rowKey,
  type DocText,
  type FolderInfo,
  type IndexRow,
  type Tag,
} from '@/lib/workspaceIndex/types';
import { SearchContainer } from '../SearchContainer';

const NOW = new Date(2026, 8, 28, 15, 30).getTime();
const ME = 'a1'.repeat(32);
const MIN = 60_000;

const index = {
  rows: [] as IndexRow[],
  folders: [] as FolderInfo[],
  folderStatus: {} as Record<string, FolderIndexStatus>,
  contextOf: () => undefined,
  refetchFolder: () => {},
};
let textIndex: TextIndex;
let tags: Tag[] = [];
let presence = new Map<
  string,
  { id: string; name: string; colour: string }[]
>();

vi.mock('@/context/WorkspaceIndexContext', () => ({
  useWorkspaceIndexValue: () => index,
  useTextIndexValue: () => textIndex,
}));
vi.mock('@/lib/search/docText', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/search/docText')>();
  return { ...real, searchText: vi.fn(real.searchText) };
});
vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ tags, byKey: new Map(tags.map((t) => [t.key, t])) }),
}));
vi.mock('@/hooks/usePresenceByDoc', () => ({
  usePresenceByDoc: () => presence,
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'w',
    selfIdentity: ME,
    namespaces: [{ namespaceId: 'w', name: 'Acme Product' }],
  }),
}));

function row(
  folderId: string,
  docId: string,
  title: string,
  over: Partial<IndexRow> = {},
): IndexRow {
  return {
    folderId,
    docId,
    title,
    tags: [],
    archived: false,
    createdAt: 0,
    updatedAt: NOW - 2 * MIN,
    createdBy: 'a',
    updatedBy: 'a',
    ...over,
  };
}

function text(
  folderId: string,
  docId: string,
  ...paras: [string, string, string][]
): DocText {
  const blocks: Block[] = paras.map(([id, kind, t]) => ({
    id,
    kind,
    depth: 0,
    attrs: {},
    spans: [{ text: t, attributes: {} }],
  }));
  return docTextFromBlocks(folderId, docId, blocks, window.location.origin);
}

function texts(...all: DocText[]): Map<string, DocText> {
  return new Map(all.map((t) => [rowKey(t.folderId, t.docId), t]));
}

let location = '';
function Where() {
  const l = useLocation();
  location = l.pathname + l.search + l.hash;
  return null;
}

function mount(recent: RecentDoc[] = [], start = '/app/w?node=2') {
  const onOpenChange = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[start]}>
      <SearchContainer open onOpenChange={onOpenChange} recent={recent} />
      <Where />
    </MemoryRouter>,
  );
  return { ...utils, onOpenChange };
}

function group(label: string) {
  return screen.getByRole('group', { name: label });
}

function optionTexts(label: string): string[] {
  return within(group(label))
    .queryAllByRole('option')
    .map((o) => o.textContent ?? '');
}

function marks(el: HTMLElement): string[] {
  return within(el)
    .queryAllByText(/./, { selector: 'mark' })
    .map((m) => m.textContent ?? '');
}

async function type(value: string) {
  await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), value);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  index.folders = [
    { id: 'f1', name: 'Product', color: '#3b82f6' },
    { id: 'f2', name: 'Specs', parentId: 'f1' },
    { id: 'f3', name: 'Roads' },
  ];
  index.folderStatus = { f1: 'ready', f2: 'ready', f3: 'ready' };
  index.rows = [
    row('f1', 'd1', 'Roadmap 2026', {
      tags: ['roadmap'],
      updatedAt: NOW - 3 * MIN,
    }),
    row('f1', 'd2', 'Q3 launch plan', { tags: ['roadmap'] }),
    row('f2', 'd3', 'API spec v2'),
    row('f1', 'old', 'Road to nowhere', { archived: true }),
    row('f2', 'blank', ''),
  ];
  tags = [
    { key: 'roadmap', name: 'roadmap', color: '#3b82f6', deleted: false },
    { key: 'q3', name: 'q3', color: '#10b981', deleted: false },
    { key: 'gone', name: 'road-gone', color: '#000', deleted: true },
  ];
  textIndex = {
    texts: new Map(),
    foldersDone: 3,
    foldersTotal: 3,
    pending: [],
    failed: [],
  };
  vi.mocked(searchText).mockClear();
  presence = new Map([['f1/d2', [{ id: 'bob', name: 'Bob', colour: '#f00' }]]]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SearchContainer before anything is typed', () => {
  it('lists recent docs that still exist, then the tags tip', () => {
    mount([
      { folderId: 'f1', docId: 'd2', openedAt: NOW - 4 * MIN },
      { folderId: 'f1', docId: 'deleted', openedAt: NOW - 5 * MIN },
      { folderId: 'f1', docId: 'old', openedAt: NOW - 6 * MIN },
      { folderId: 'f2', docId: 'd3', openedAt: NOW - 60 * MIN },
    ]);
    expect(optionTexts('Recent')).toEqual([
      expect.stringMatching(
        /^Q3 launch planProduct · opened 4 min agoBob is here/,
      ),
      expect.stringMatching(/^API spec v2Product \/ Specs · opened 1 h ago/),
    ]);
    const [tip] = within(group('Tips')).getAllByRole('option');
    expect(tip.getAttribute('aria-disabled')).toBe('true');
    expect(tip.textContent).toContain('Type # to search tags only');
    expect(group('Tips').textContent).toContain(
      'Type @me for documents that mention you',
    );
    expect(group('Tips').textContent).toContain('roadmapq3');
    expect(screen.getByText('Acme Product')).not.toBeNull();
  });

  it('treats spaces or punctuation as nothing typed', async () => {
    mount([{ folderId: 'f1', docId: 'd1', openedAt: NOW }]);
    await type(' .. ');
    expect(optionTexts('Recent')).toHaveLength(1);
    expect(
      screen.queryByText('No documents, folders or tags match'),
    ).toBeNull();
  });
});

describe('SearchContainer results', () => {
  it('matches titles, folders and tags, leaving archived docs out', async () => {
    mount();
    await type('road');
    const docs = within(group('Documents')).getAllByRole('option');
    expect(docs.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Roadmap 2026Product · roadmap · 3 min ago/),
    ]);
    expect(marks(docs[0])).toEqual(['Road']);
    expect(optionTexts('Folders')).toEqual(['Roads']);
    const tag = within(group('Tags')).getByRole('option');
    expect(tag.textContent).toContain(
      '#roadmap2 documents · show them all on Home',
    );
    expect(marks(tag)).toEqual(['road']);
    expect(screen.queryByText(/Road to nowhere/)).toBeNull();
    expect(screen.queryByText(/road-gone/)).toBeNull();
  });

  it('searches only tags after #, and lists them all by count for # alone', async () => {
    mount();
    await type('#');
    expect(screen.getAllByRole('group')).toEqual([group('Tags')]);
    expect(optionTexts('Tags')).toEqual([
      '#roadmap2 documents · show them all on Home',
      '#q30 documents · show them all on Home',
    ]);
    await type('q');
    expect(optionTexts('Tags')).toEqual([
      '#q30 documents · show them all on Home',
    ]);
    expect(screen.queryByRole('group', { name: 'Documents' })).toBeNull();
  });

  it('shows the best text match per doc with its heading, Untitled included', async () => {
    textIndex = {
      ...textIndex,
      texts: texts(
        text(
          'f2',
          'd3',
          ['h1', 'heading', 'Versioning'],
          ['p1', 'paragraph', 'The public roadmap commits us.'],
        ),
        text('f2', 'blank', ['p2', 'paragraph', 'A roadmap nobody named']),
        text('f1', 'old', ['p3', 'paragraph', 'roadmap in an archived doc']),
      ),
    };
    mount();
    await type('roadm');
    const hits = await within(
      await screen.findByRole('group', { name: 'In document text' }),
    ).findAllByRole('option');
    expect(hits.map((h) => h.textContent)).toEqual([
      'API spec v2Product / Specs · in “Versioning”The public roadmap commits us.',
      'UntitledProduct / SpecsA roadmap nobody named',
    ]);
    expect(marks(hits[0])).toEqual(['roadm']);
  });

  it('scans doc text once typing pauses, not on every keystroke', async () => {
    textIndex = {
      ...textIndex,
      texts: texts(text('f2', 'd3', ['p1', 'paragraph', 'a road trip'])),
    };
    mount();
    await type('road');
    await within(
      await screen.findByRole('group', { name: 'In document text' }),
    ).findByRole('option');
    expect(searchText).toHaveBeenCalledTimes(1);
    expect(searchText).toHaveBeenCalledWith('road', textIndex.texts);

    await type(' trip');
    await waitFor(() =>
      expect(searchText).toHaveBeenLastCalledWith('road trip', textIndex.texts),
    );
    expect(searchText).toHaveBeenCalledTimes(2);
  });

  it('hides text matches for an older query until the new one is scanned', async () => {
    textIndex = {
      ...textIndex,
      texts: texts(text('f2', 'd3', ['p1', 'paragraph', 'the zebra crossing'])),
    };
    mount();
    await type('zebra');
    await within(
      await screen.findByRole('group', { name: 'In document text' }),
    ).findByRole('option');
    await type(' c');
    expect(
      screen.queryByRole('group', { name: 'In document text' }),
    ).toBeNull();
    const hit = await within(
      await screen.findByRole('group', { name: 'In document text' }),
    ).findByRole('option');
    expect(marks(hit)).toEqual(['zebra c']);
  });

  it('names a folder with a doc it could not read, and stops the progress for it', async () => {
    textIndex = {
      ...textIndex,
      foldersDone: 2,
      foldersTotal: 3,
      pending: ['f1'],
      failed: ['f1'],
    };
    mount();
    await type('road');
    expect(screen.getByText(/could not be fully searched/).textContent).toBe(
      'Product could not be fully searched.',
    );
    expect(screen.queryByText(/folders searched/)).toBeNull();
  });

  it('says how far the text search has got while it builds', async () => {
    textIndex = { ...textIndex, foldersDone: 1, foldersTotal: 3 };
    mount();
    await type('zzz');
    expect(
      within(group('In document text')).getByText('1 of 3 folders searched'),
    ).not.toBeNull();
  });

  it('names member folders it could not search, never a folder you are not in', async () => {
    index.folders = [
      ...index.folders,
      { id: 'f4', name: 'Finance' },
      { id: 'f5', name: 'Legal' },
    ];
    // f9 is a restricted folder this member is not in: it has a status but is not theirs.
    index.folderStatus = {
      ...index.folderStatus,
      f4: 'syncing',
      f5: 'error',
      f9: 'syncing',
    };
    mount();
    await type('road');
    expect(
      screen.getByText(/is still syncing, so it was not searched yet\./)
        .textContent,
    ).toBe(
      'Finance is still syncing, so it was not searched yet. Legal could not be searched.',
    );
    expect(screen.getByText('Finance').tagName).toBe('B');
  });

  it('joins several folders in one warning', async () => {
    index.folders = [
      ...index.folders,
      { id: 'f4', name: 'Finance' },
      { id: 'f5', name: 'Legal' },
    ];
    index.folderStatus = {
      ...index.folderStatus,
      f4: 'syncing',
      f5: 'syncing',
    };
    mount();
    await type('road');
    expect(screen.getByText(/still syncing/).textContent).toBe(
      'Finance and Legal are still syncing, so they were not searched yet.',
    );
  });

  it('says so when nothing matches', async () => {
    mount();
    await type('zebra');
    expect(
      screen.getByText('No documents, folders or tags match'),
    ).not.toBeNull();
  });
});

describe('SearchContainer opening', () => {
  it('opens a doc and closes', async () => {
    const { onOpenChange } = mount();
    await type('roadmap 2026{Enter}');
    expect(location).toBe('/app/w/f/f1/d/d1?node=2');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens a text match at its block', async () => {
    textIndex = {
      ...textIndex,
      texts: texts(text('f2', 'd3', ['p1', 'paragraph', 'zebra crossing'])),
    };
    mount();
    await type('zebra');
    await screen.findByRole('group', { name: 'In document text' });
    await userEvent.keyboard('{Enter}');
    expect(location).toBe('/app/w/f/f2/d/d3?node=2#b=p1');
  });

  it('lists the docs that mention you for @me, with the sentence, opening at the mention', async () => {
    const mention = (folderId: string, docId: string, member: string) =>
      docTextFromBlocks(
        folderId,
        docId,
        [
          {
            id: `m-${docId}`,
            kind: 'paragraph',
            depth: 0,
            attrs: {},
            spans: [
              { text: 'Ask ' },
              { text: '@Ann', attributes: { link: `/app/w/m/${member}` } },
              { text: ' first.' },
            ],
          },
        ],
        window.location.origin,
      );
    textIndex = {
      ...textIndex,
      texts: texts(
        mention('f2', 'd3', ME),
        mention('f1', 'd1', 'b2'.repeat(32)),
        mention('f1', 'old', ME),
      ),
    };
    mount();
    await type('@me');
    expect(optionTexts('Mentions')).toEqual([
      expect.stringMatching(/^API spec v2Product \/ SpecsAsk @Ann first\.$/),
    ]);
    expect(screen.queryByRole('group', { name: 'Documents' })).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(location).toBe('/app/w/f/f2/d/d3?node=2#b=m-d3');
  });

  it('shows progress, never "no mentions", for @me while docs are still being read', async () => {
    textIndex = { ...textIndex, foldersDone: 1, pending: ['f2', 'f3'] };
    mount();
    await type('@me');
    expect(group('Mentions').textContent).toContain('1 of 3 folders searched');
    expect(screen.queryByText('No documents mention you yet')).toBeNull();
  });

  it('names a folder it could not fully read for @me', async () => {
    textIndex = {
      ...textIndex,
      foldersDone: 2,
      pending: ['f3'],
      failed: ['f3'],
    };
    mount();
    await type('@me');
    expect(screen.getByText(/could not be fully searched/).textContent).toBe(
      'Roads could not be fully searched.',
    );
  });

  it('opens a folder, and a tag as Home filtered to it', async () => {
    mount();
    await type('roads{Enter}');
    expect(location).toBe('/app/w/f/f3?node=2');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search' }));
    await type('#roadmap{Enter}');
    expect(location).toBe('/app/w?tag=roadmap&node=2');
  });

  it('opens a recent doc', async () => {
    mount([{ folderId: 'f2', docId: 'd3', openedAt: NOW }]);
    await userEvent.keyboard('{Enter}');
    expect(location).toBe('/app/w/f/f2/d/d3?node=2');
  });

  it('opens the URL in a new tab on Cmd/Ctrl+Enter and stays open', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { onOpenChange } = mount();
    await type('roadmap 2026');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(open).toHaveBeenCalledWith(
      '/app/w/f/f1/d/d1?node=2',
      '_blank',
      'noopener',
    );
    expect(location).toBe('/app/w?node=2');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
