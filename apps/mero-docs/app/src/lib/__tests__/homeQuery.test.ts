import { describe, expect, it } from 'vitest';
import {
  applyHomeQuery,
  isHomeQueryFiltered,
  isMentionsPage,
  parseHomeQuery,
  serializeHomeQuery,
  tagPageKey,
  viewRowCount,
  withView,
  type HomeQuery,
} from '../homeQuery';
import type { FolderInfo } from '../workspaceIndex/types';
import { row } from '../workspaceIndex/__tests__/row';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 28, 10, 30).getTime();
const MIDNIGHT = new Date(2026, 8, 28).getTime();

const EMPTY: HomeQuery = {
  folders: [],
  tags: [],
  archived: false,
  sort: 'updated',
};

function parse(search: string): HomeQuery {
  return parseHomeQuery(new URLSearchParams(search));
}

function ids(rows: { docId: string }[]): string[] {
  return rows.map((r) => r.docId);
}

describe('parseHomeQuery', () => {
  it('reads an empty query as the defaults', () => {
    expect(parse('')).toEqual(EMPTY);
  });

  it('reads every filter', () => {
    expect(
      parse(
        'folder=a,b&tag=launch&updated=7d&by=bob&mentions=me&archived=true&sort=name&view=v1',
      ),
    ).toEqual({
      folders: ['a', 'b'],
      tags: ['launch'],
      updated: '7d',
      by: 'bob',
      mentions: 'me',
      archived: true,
      sort: 'name',
      view: 'v1',
    });
  });

  it('merges repeated multi-value params and drops duplicates and blanks (R-18)', () => {
    expect(parse('tag=a,b&tag=b,,c&folder=x&folder=x').tags).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(parse('folder=x&folder=x').folders).toEqual(['x']);
  });

  it('drops bad values and unknown params (R-18)', () => {
    expect(
      parse(
        'updated=2d&sort=size&archived=yes&by=&view=&color=red&folder=&mentions=bob',
      ),
    ).toEqual(EMPTY);
  });

  it('keeps the first of a repeated single-value param', () => {
    expect(parse('sort=name&sort=created').sort).toBe('name');
  });

  it('keeps tag keys the registry does not know, so the chip can say Unknown (T-21)', () => {
    expect(parse('tag=gone-tag').tags).toEqual(['gone-tag']);
  });
});

describe('serializeHomeQuery', () => {
  it('omits the defaults', () => {
    expect(serializeHomeQuery(EMPTY)).toBe('');
  });

  it('writes the canonical key order with comma lists', () => {
    const q: HomeQuery = {
      view: 'v1',
      sort: 'created',
      archived: true,
      mentions: 'me',
      by: 'bob',
      updated: '1d',
      tags: ['t1', 't2'],
      folders: ['a', 'b'],
    };
    expect(serializeHomeQuery(q)).toBe(
      'folder=a,b&tag=t1,t2&updated=1d&by=bob&mentions=me&archived=true&sort=created&view=v1',
    );
  });

  it('de-duplicates lists and drops empty values', () => {
    expect(
      serializeHomeQuery({ ...EMPTY, tags: ['a', 'a', ''], by: '', view: '' }),
    ).toBe('tag=a');
  });

  it('round-trips through parse, including ids that need escaping', () => {
    const q: HomeQuery = {
      folders: ['a b', 'c&d'],
      tags: ['launch'],
      updated: '30d',
      by: 'k=1',
      mentions: 'me',
      archived: false,
      sort: 'name',
      view: 'v?1',
    };
    expect(parse(serializeHomeQuery(q))).toEqual(q);
  });

  it('rewrites a messy URL canonically (R-18)', () => {
    expect(
      serializeHomeQuery(parse('sort=bad&tag=b,a,b&junk=1&folder=f')),
    ).toBe('folder=f&tag=b,a');
  });
});

describe('applyHomeQuery', () => {
  const folders: FolderInfo[] = [
    { id: 'root', name: 'Root' },
    { id: 'child', name: 'Child', parentId: 'root' },
    { id: 'grand', name: 'Grand', parentId: 'child' },
    { id: 'other', name: 'Other' },
  ];

  it('hides archived docs by default and shows only archived ones when asked', () => {
    const rows = [
      row({ docId: 'live' }),
      row({ docId: 'old', archived: true }),
    ];
    expect(ids(applyHomeQuery(rows, EMPTY, NOW, folders))).toEqual(['live']);
    expect(
      ids(applyHomeQuery(rows, { ...EMPTY, archived: true }, NOW, folders)),
    ).toEqual(['old']);
  });

  it('includes descendant folders in a folder filter', () => {
    const rows = [
      row({ docId: 'r', folderId: 'root' }),
      row({ docId: 'c', folderId: 'child' }),
      row({ docId: 'g', folderId: 'grand' }),
      row({ docId: 'o', folderId: 'other' }),
    ];
    const q = { ...EMPTY, folders: ['child'], sort: 'name' as const };
    expect(ids(applyHomeQuery(rows, q, NOW, folders))).toEqual(['c', 'g']);
    const both = { ...q, folders: ['root', 'other'] };
    expect(ids(applyHomeQuery(rows, both, NOW, folders))).toEqual([
      'c',
      'g',
      'o',
      'r',
    ]);
  });

  it('survives a parent cycle in the folder tree', () => {
    const cyclic: FolderInfo[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ];
    const rows = [row({ docId: 'x', folderId: 'b' })];
    const q = { ...EMPTY, folders: ['a'] };
    expect(ids(applyHomeQuery(rows, q, NOW, cyclic))).toEqual(['x']);
  });

  it('matches any selected tag', () => {
    const rows = [
      row({ docId: 'a', tags: ['x'] }),
      row({ docId: 'b', tags: ['y', 'z'] }),
      row({ docId: 'c' }),
    ];
    const q = { ...EMPTY, tags: ['x', 'z'], sort: 'name' as const };
    expect(ids(applyHomeQuery(rows, q, NOW, folders))).toEqual(['a', 'b']);
  });

  it('keeps only the docs that mention you when Mentioned me is on', () => {
    const rows = [
      row({ docId: 'a', folderId: 'root' }),
      row({ docId: 'b', folderId: 'root' }),
    ];
    const q: HomeQuery = { ...EMPTY, mentions: 'me' };
    expect(
      ids(applyHomeQuery(rows, q, NOW, folders, new Set(['root/b']))),
    ).toEqual(['b']);
    expect(ids(applyHomeQuery(rows, q, NOW, folders))).toEqual([]);
    expect(
      ids(applyHomeQuery(rows, EMPTY, NOW, folders, new Set())),
    ).toHaveLength(2);
  });

  it('filters by creator', () => {
    const rows = [
      row({ docId: 'a', createdBy: 'bob', updatedBy: 'alice' }),
      row({ docId: 'b', createdBy: 'alice', updatedBy: 'bob' }),
    ];
    expect(
      ids(applyHomeQuery(rows, { ...EMPTY, by: 'bob' }, NOW, folders)),
    ).toEqual(['a']);
  });

  it('starts Today at local midnight', () => {
    const rows = [
      row({ docId: 'midnight', updatedAt: MIDNIGHT }),
      row({ docId: 'yesterday', updatedAt: MIDNIGHT - 1 }),
    ];
    expect(
      ids(applyHomeQuery(rows, { ...EMPTY, updated: '1d' }, NOW, folders)),
    ).toEqual(['midnight']);
  });

  it('uses rolling windows for 7 and 30 days', () => {
    const rows = [
      row({ docId: 'in7', updatedAt: NOW - 7 * DAY }),
      row({ docId: 'out7', updatedAt: NOW - 7 * DAY - 1 }),
      row({ docId: 'in30', updatedAt: NOW - 30 * DAY }),
      row({ docId: 'out30', updatedAt: NOW - 30 * DAY - 1 }),
    ];
    expect(
      ids(applyHomeQuery(rows, { ...EMPTY, updated: '7d' }, NOW, folders)),
    ).toEqual(['in7']);
    expect(
      ids(applyHomeQuery(rows, { ...EMPTY, updated: '30d' }, NOW, folders)),
    ).toEqual(['in7', 'out7', 'in30']);
  });

  it('sorts by last updated, newest first (R-19)', () => {
    const rows = [
      row({ docId: 'a', updatedAt: 1 }),
      row({ docId: 'b', updatedAt: 3 }),
      row({ docId: 'c', updatedAt: 2 }),
    ];
    expect(ids(applyHomeQuery(rows, EMPTY, NOW, folders))).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('sorts by created, newest first (R-19)', () => {
    const rows = [
      row({ docId: 'a', createdAt: 5, updatedAt: 1 }),
      row({ docId: 'b', createdAt: 1, updatedAt: 9 }),
    ];
    const q = { ...EMPTY, sort: 'created' as const };
    expect(ids(applyHomeQuery(rows, q, NOW, folders))).toEqual(['a', 'b']);
  });

  it('sorts by name ignoring case, with a blank title as Untitled (R-19)', () => {
    const rows = [
      row({ docId: 'z', title: 'zebra' }),
      row({ docId: 'u', title: '' }),
      row({ docId: 'a', title: 'Apple' }),
      row({ docId: 'b', title: 'banana' }),
    ];
    const q = { ...EMPTY, sort: 'name' as const };
    expect(ids(applyHomeQuery(rows, q, NOW, folders))).toEqual([
      'a',
      'b',
      'u',
      'z',
    ]);
  });

  it('treats names differing only in case as equal', () => {
    const rows = [
      row({ docId: 'x', title: 'plan' }),
      row({ docId: 'a', title: 'Plan' }),
    ];
    const q = { ...EMPTY, sort: 'name' as const };
    expect(ids(applyHomeQuery(rows, q, NOW, folders))).toEqual(['a', 'x']);
  });

  it('breaks sort ties by row key so the order is stable across refetches', () => {
    const rows = [
      row({ docId: 'b', updatedAt: 1 }),
      row({ docId: 'a', updatedAt: 1 }),
    ];
    expect(ids(applyHomeQuery(rows, EMPTY, NOW, folders))).toEqual(['a', 'b']);
  });

  it('does not reorder or mutate the input', () => {
    const rows = [
      row({ docId: 'a', updatedAt: 1 }),
      row({ docId: 'b', updatedAt: 2 }),
    ];
    applyHomeQuery(rows, EMPTY, NOW, folders);
    expect(ids(rows)).toEqual(['a', 'b']);
  });
});

describe('isHomeQueryFiltered', () => {
  it('is false for the defaults, a bare sort change or a bare view', () => {
    expect(isHomeQueryFiltered(EMPTY)).toBe(false);
    expect(isHomeQueryFiltered({ ...EMPTY, sort: 'name' })).toBe(false);
    expect(isHomeQueryFiltered({ ...EMPTY, view: 'v1' })).toBe(false);
  });

  it('is true for any real filter', () => {
    expect(isHomeQueryFiltered({ ...EMPTY, folders: ['a'] })).toBe(true);
    expect(isHomeQueryFiltered({ ...EMPTY, tags: ['a'] })).toBe(true);
    expect(isHomeQueryFiltered({ ...EMPTY, updated: '7d' })).toBe(true);
    expect(isHomeQueryFiltered({ ...EMPTY, by: 'bob' })).toBe(true);
    expect(isHomeQueryFiltered({ ...EMPTY, archived: true })).toBe(true);
    expect(isHomeQueryFiltered({ ...EMPTY, mentions: 'me' })).toBe(true);
  });
});

describe('isMentionsPage', () => {
  it('is the Mentions page when Mentioned me is the only filter, any sort', () => {
    expect(isMentionsPage(parse('mentions=me'))).toBe(true);
    expect(isMentionsPage(parse('mentions=me&sort=name'))).toBe(true);
    expect(isMentionsPage(parse('mentions=me&view=v1'))).toBe(true);
  });

  it('is not for no mentions filter or any other filter beside it', () => {
    for (const search of [
      '',
      'tag=q3',
      'mentions=me&tag=q3',
      'mentions=me&archived=true',
    ]) {
      expect(isMentionsPage(parse(search))).toBe(false);
    }
  });
});

describe('withView', () => {
  it('adds the view id to a stored query, in canonical order', () => {
    expect(withView('tag=design&updated=7d', 'v1')).toBe(
      'tag=design&updated=7d&view=v1',
    );
  });

  it('replaces a view id already on the query', () => {
    expect(withView('tag=design&view=old', 'v1')).toBe('tag=design&view=v1');
  });
});

describe('viewRowCount', () => {
  const folders: FolderInfo[] = [{ id: 'f1', name: 'One' }];

  it('counts the rows a stored query matches', () => {
    const rows = [
      row({ docId: 'a', folderId: 'f1', tags: ['design'] }),
      row({ docId: 'b', folderId: 'f1', tags: ['other'] }),
    ];
    expect(viewRowCount(rows, folders, NOW, 'tag=design')).toBe(1);
  });

  it('counts a Mentioned me view over the docs that mention you', () => {
    const rows = [
      row({ docId: 'a', folderId: 'f1' }),
      row({ docId: 'b', folderId: 'f1' }),
    ];
    const mentioned = new Set(['f1/b', 'gone/x']);
    expect(viewRowCount(rows, folders, NOW, 'mentions=me', mentioned)).toBe(1);
    expect(viewRowCount(rows, folders, NOW, 'mentions=me')).toBe(0);
  });

  it('is zero, not a crash, for a tag or folder no row carries any more (R-23)', () => {
    const rows = [row({ docId: 'a', folderId: 'f1', tags: ['design'] })];
    expect(viewRowCount(rows, folders, NOW, 'tag=deleted-tag')).toBe(0);
    expect(viewRowCount(rows, folders, NOW, 'folder=deleted-folder')).toBe(0);
  });
});

describe('tagPageKey', () => {
  it('is the tag when the query is that one tag and nothing else (T-20)', () => {
    expect(tagPageKey(parse('tag=q3'))).toBe('q3');
    expect(tagPageKey(parse('tag=q3&sort=name'))).toBe('q3');
  });

  it('is nothing for no tag, two tags or any other filter', () => {
    for (const search of [
      '',
      'tag=q3,plan',
      'tag=q3&folder=f1',
      'tag=q3&updated=7d',
      'tag=q3&by=bob',
      'tag=q3&archived=true',
      'tag=q3&mentions=me',
    ]) {
      expect(tagPageKey(parse(search))).toBeNull();
    }
  });
});
