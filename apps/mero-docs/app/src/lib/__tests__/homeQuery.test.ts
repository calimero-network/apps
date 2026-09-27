import { describe, expect, it } from 'vitest';
import {
  applyHomeQuery,
  parseHomeQuery,
  serializeHomeQuery,
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
        'folder=a,b&tag=launch&updated=7d&by=bob&archived=true&sort=name&view=v1',
      ),
    ).toEqual({
      folders: ['a', 'b'],
      tags: ['launch'],
      updated: '7d',
      by: 'bob',
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
      parse('updated=2d&sort=size&archived=yes&by=&view=&color=red&folder='),
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
      by: 'bob',
      updated: '1d',
      tags: ['t1', 't2'],
      folders: ['a', 'b'],
    };
    expect(serializeHomeQuery(q)).toBe(
      'folder=a,b&tag=t1,t2&updated=1d&by=bob&archived=true&sort=created&view=v1',
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
