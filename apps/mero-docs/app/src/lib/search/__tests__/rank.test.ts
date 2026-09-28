import { describe, expect, it } from 'vitest';
import { searchV1, type PaletteResult } from '../rank';
import type { Tag } from '../../workspaceIndex/types';
import { row } from '../../workspaceIndex/__tests__/row';

function tag(key: string, name: string, deleted = false): Tag {
  return { key, name, color: '#3b82f6', deleted };
}

function labels(results: PaletteResult[]): string[] {
  return results.map((r) =>
    r.kind === 'doc'
      ? `doc:${r.row.docId}`
      : r.kind === 'folder'
        ? `folder:${r.folderId}`
        : `tag:${r.tag.key}`,
  );
}

describe('searchV1', () => {
  it('ranks docs by prefix, word start, substring, then newest (S-04)', () => {
    const rows = [
      row({ docId: 'sub', title: 'Railroad', updatedAt: 9 }),
      row({ docId: 'word', title: 'The road ahead', updatedAt: 8 }),
      row({ docId: 'oldPrefix', title: 'Roadmap', updatedAt: 1 }),
      row({ docId: 'newPrefix', title: 'Road trip', updatedAt: 5 }),
      row({ docId: 'miss', title: 'Budget' }),
    ];
    expect(labels(searchV1('road', rows, [], []))).toEqual([
      'doc:newPrefix',
      'doc:oldPrefix',
      'doc:word',
      'doc:sub',
    ]);
  });

  it('puts docs, then folders, then tags, each ranked the same way (S-04)', () => {
    const rows = [
      row({ docId: 'd', title: 'Road', tags: ['r2', 'r2b'] }),
      row({ docId: 'x', title: 'Budget', tags: ['r1'] }),
    ];
    const folders = [
      { id: 'f-sub', name: 'Railroads' },
      { id: 'f-pre', name: 'Roadmaps' },
    ];
    const tags = [tag('r1', 'offroad'), tag('r2', 'road'), tag('r2b', 'roads')];
    expect(labels(searchV1('road', rows, folders, tags))).toEqual([
      'doc:d',
      'folder:f-pre',
      'folder:f-sub',
      'tag:r2',
      'tag:r2b',
      'tag:r1',
    ]);
  });

  it('matches title words in any order, each marked, and needs them all', () => {
    const rows = [
      row({ docId: 'q3', title: 'Q3 Roadmap' }),
      row({ docId: 'q4', title: 'Q4 Roadmap' }),
    ];
    const results = searchV1('roadmap q3', rows, [], []);
    expect(labels(results)).toEqual(['doc:q3']);
    expect(results[0].ranges).toEqual([
      [0, 2],
      [3, 10],
    ]);
  });

  it('offers typos only when nothing matches exactly', () => {
    const rows = [
      row({ docId: 'exact', title: 'Roadmap', updatedAt: 1 }),
      row({ docId: 'typo', title: 'Read me', updatedAt: 9 }),
    ];
    expect(labels(searchV1('road', rows, [], []))).toEqual(['doc:exact']);
    const [hit, ...rest] = searchV1('roadmpa', rows, [], []);
    expect(labels([hit, ...rest])).toEqual(['doc:exact']);
    expect(hit.ranges).toEqual([[0, 7]]);
    expect(hit.typo).toBe(true);
  });

  it('drops typos in every group when any group matches exactly, so Enter never opens a typo', () => {
    const rows = [row({ docId: 'd', title: 'Roadmap', tags: ['t'] })];
    const folders = [{ id: 'f', name: 'Roads' }];
    const tags = [tag('t', 'roadmap')];
    expect(labels(searchV1('roads', rows, folders, tags))).toEqual([
      'folder:f',
    ]);
    expect(labels(searchV1('roadz', rows, [], tags))).toEqual([
      'doc:d',
      'tag:t',
    ]);
  });

  it('forgives typos in folder and tag names, and after #', () => {
    const rows = [row({ docId: 'd', title: 'Plan', tags: ['l'] })];
    const folders = [{ id: 'f', name: 'Product' }];
    const tags = [tag('l', 'launch')];
    expect(labels(searchV1('prodcut', rows, folders, tags))).toEqual([
      'folder:f',
    ]);
    expect(labels(searchV1('#lanuch', rows, folders, tags))).toEqual(['tag:l']);
  });

  // A guard against a quadratic regression, loose enough for a busy CI runner.
  it('matches 5,000 titles against three words with a typo in under 2 s', () => {
    const words = ['alpha', 'beta', 'gamma', 'delta', 'Résumé', '日本', '🚀'];
    const rows = Array.from({ length: 5000 }, (_, i) =>
      row({
        docId: `d${i}`,
        title: Array.from(
          { length: 4 },
          (_, w) => words[(i + w) % words.length],
        ).join(' '),
        updatedAt: i,
      }),
    );
    searchV1('warm up', rows, [], []);
    const started = performance.now();
    const results = searchV1('gamma resmue delta', rows, [], []);
    const elapsed = performance.now() - started;
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('highlights the matched characters on the shown label', () => {
    const rows = [row({ docId: 'd', title: 'Mon Résumé' })];
    const [hit] = searchV1('resume', rows, [], []);
    expect(hit.ranges).toEqual([[4, 10]]);
  });

  it('caps each group', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ docId: `d${i}`, title: `Plan ${i}` }),
    );
    const folders = Array.from({ length: 6 }, (_, i) => ({
      id: `f${i}`,
      name: `Plan ${i}`,
    }));
    const tags = Array.from({ length: 7 }, (_, i) => tag(`t${i}`, `plan-${i}`));
    rows[0].tags = tags.map((t) => t.key);
    const results = searchV1('plan', rows, folders, tags);
    const count = (kind: PaletteResult['kind']) =>
      results.filter((r) => r.kind === kind).length;
    expect([count('doc'), count('folder'), count('tag')]).toEqual([8, 4, 5]);
    expect(
      searchV1('plan', rows, folders, tags, { docs: 1, folders: 1, tags: 1 }),
    ).toHaveLength(3);
  });

  it('leaves archived docs out (S-21)', () => {
    const rows = [
      row({ docId: 'live', title: 'Plan' }),
      row({ docId: 'old', title: 'Plan', archived: true }),
    ];
    expect(labels(searchV1('plan', rows, [], []))).toEqual(['doc:live']);
  });

  it('finds a blank title as Untitled (S-22)', () => {
    const rows = [row({ docId: 'blank', title: '' })];
    const [hit] = searchV1('untit', rows, [], []);
    expect(labels([hit])).toEqual(['doc:blank']);
    expect(hit.ranges).toEqual([[0, 5]]);
  });

  it('matches folder names shown as Untitled folder', () => {
    expect(
      labels(searchV1('untitled f', [], [{ id: 'f', name: '' }], [])),
    ).toEqual(['folder:f']);
  });

  it('returns nothing for an empty query, so the palette shows Recent (S-07)', () => {
    const rows = [row({ docId: 'd', title: 'Plan' })];
    expect(searchV1('   ', rows, [], [])).toEqual([]);
    expect(searchV1('..', rows, [], [])).toEqual([]);
  });

  it('searches only tags after # (S-09)', () => {
    const rows = [row({ docId: 'd', title: 'launch plan', tags: ['l'] })];
    const tags = [tag('l', 'launch'), tag('p', 'planning')];
    expect(
      labels(searchV1('#lau', rows, [{ id: 'f', name: 'launch' }], tags)),
    ).toEqual(['tag:l']);
  });

  it('lists every tag on a readable doc by count after # alone (S-09)', () => {
    const rows = [
      row({ docId: 'a', tags: ['b', 'c'] }),
      row({ docId: 'b', tags: ['c'] }),
      row({ docId: 'z', tags: ['a', 'a2'], archived: true }),
    ];
    const tags = [
      tag('a', 'alpha'),
      tag('b', 'beta'),
      tag('c', 'gamma'),
      tag('d', 'deleted', true),
      ...Array.from({ length: 5 }, (_, i) => tag(`z${i}`, `zeta ${i}`)),
    ];
    const results = searchV1('#', rows, [], tags);
    expect(labels(results)).toEqual(['tag:c', 'tag:b']);
    const counts = results.map((r) => (r.kind === 'tag' ? r.count : -1));
    expect(counts).toEqual([2, 1]);
  });

  it('leaves out tags whose docs this member cannot read, like the sidebar', () => {
    const rows = [row({ docId: 'd', title: 'Plan', tags: ['seen'] })];
    const tags = [tag('seen', 'payroll'), tag('hidden', 'payroll review')];
    expect(labels(searchV1('payroll', rows, [], tags))).toEqual(['tag:seen']);
    expect(labels(searchV1('#pay', rows, [], tags))).toEqual(['tag:seen']);
  });

  it('leaves deleted tags out', () => {
    expect(searchV1('old', [], [], [tag('o', 'old', true)])).toEqual([]);
  });
});
