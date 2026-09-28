import { describe, expect, it } from 'vitest';
import { defaultViewName, SORT_LABELS, summarizeHomeQuery } from '../filterSummary';
import type { HomeQuery } from '@/lib/homeQuery';
import type { Tag } from '@/lib/workspaceIndex/types';

const EMPTY: HomeQuery = {
  folders: [],
  tags: [],
  archived: false,
  sort: 'updated',
};

const tag = (key: string, name = key, color = '#8b5cf6'): Tag => ({
  key,
  name,
  color,
  deleted: false,
});

const args = (over: Partial<Parameters<typeof summarizeHomeQuery>[0]> = {}) => ({
  q: EMPTY,
  tagsByKey: new Map<string, Tag>(),
  paths: new Map(),
  selfIdentity: 'me',
  namespaceMemberNames: {},
  sortLabel: SORT_LABELS.updated,
  ...over,
});

describe('summarizeHomeQuery', () => {
  it('always includes the sort, even with no filter on', () => {
    expect(summarizeHomeQuery(args())).toEqual([
      { icon: 'sort', label: 'Last updated' },
    ]);
  });

  it('names a tag and its colour, and falls back for a deleted or unknown one', () => {
    const tagsByKey = new Map([['design', tag('design', 'Design', '#8b5cf6')]]);
    expect(
      summarizeHomeQuery(
        args({ q: { ...EMPTY, tags: ['design', 'gone'] }, tagsByKey }),
      ),
    ).toEqual([
      { icon: 'tag', label: 'Design', color: '#8b5cf6' },
      { icon: 'tag', label: 'Unknown tag', color: '#94a3b8' },
      { icon: 'sort', label: 'Last updated' },
    ]);
  });

  it('names a folder path and falls back for an unknown one', () => {
    const paths = new Map([['f1', { names: ['Eng', 'Specs'], ids: ['f1'] }]]);
    expect(
      summarizeHomeQuery(args({ q: { ...EMPTY, folders: ['f1', 'gone'] }, paths })),
    ).toEqual([
      { icon: 'folder', label: 'Eng / Specs' },
      { icon: 'folder', label: 'Unknown folder' },
      { icon: 'sort', label: 'Last updated' },
    ]);
  });

  it('labels the updated window, self and archived', () => {
    expect(
      summarizeHomeQuery(
        args({ q: { ...EMPTY, updated: '7d', by: 'me', archived: true } }),
      ),
    ).toEqual([
      { icon: 'calendar', label: 'Last 7 days' },
      { icon: 'user', label: 'You' },
      { icon: 'archive', label: 'Archived' },
      { icon: 'sort', label: 'Last updated' },
    ]);
  });

  it('names another member, or the fallback label for one with no display name', () => {
    expect(
      summarizeHomeQuery(
        args({
          q: { ...EMPTY, by: 'bob' },
          namespaceMemberNames: { bob: 'Bob' },
        }),
      ),
    ).toEqual([{ icon: 'user', label: 'Bob' }, { icon: 'sort', label: 'Last updated' }]);
    expect(
      summarizeHomeQuery(args({ q: { ...EMPTY, by: 'bob' } })),
    ).toEqual([{ icon: 'user', label: 'Unnamed member' }, { icon: 'sort', label: 'Last updated' }]);
  });
});

describe('defaultViewName', () => {
  it('is a lone tag name', () => {
    const tagsByKey = new Map([['design', tag('design', 'Design')]]);
    expect(
      defaultViewName(args({ q: { ...EMPTY, tags: ['design'] }, tagsByKey })),
    ).toBe('Design');
  });

  it('joins several active filters', () => {
    expect(
      defaultViewName(args({ q: { ...EMPTY, archived: true, by: 'me' } })),
    ).toBe('You, Archived');
  });

  it('fits the name limit however many filters are on', () => {
    const keys = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
    const tagsByKey = new Map(keys.map((k) => [k, tag(k, `${k} team`)]));
    const name = defaultViewName(args({ q: { ...EMPTY, tags: keys }, tagsByKey }));
    expect(name).toHaveLength(60);
    expect(name.startsWith('alpha team, bravo team')).toBe(true);
  });

  it('falls back to New view with nothing on', () => {
    expect(defaultViewName(args())).toBe('New view');
  });
});
