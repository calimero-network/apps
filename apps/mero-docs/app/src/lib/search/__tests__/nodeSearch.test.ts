import { describe, expect, it, vi } from 'vitest';
import type { DocsClient, DocSearchPage } from '@/generated/docs/DocsClient';
import type { DocText } from '../../workspaceIndex/types';
import {
  blockOf,
  folderMatches,
  isIndexUnavailable,
  NODE_FILTER_PAGE,
  parseSnippet,
  searchFolder,
} from '../nodeSearch';

function client(pages: DocSearchPage[]) {
  const searchDocs = vi.fn(async () => pages.shift()!);
  return { client: { searchDocs } as unknown as DocsClient, searchDocs };
}

const page = (ids: string[], next: number | null = null): DocSearchPage => ({
  hits: ids.map((id) => ({
    id,
    title: `T ${id}`,
    snippet: `the <b>plan</b> for ${id}`,
    score: 1,
    archived: false,
  })),
  total: ids.length,
  next_cursor: next,
});

describe('parseSnippet', () => {
  it('reads the bold words as ranges of the plain text', () => {
    const { text, ranges } = parseSnippet(
      'the <b>budget</b> &amp; the <b>plan</b>',
    );
    expect(text).toBe('the budget & the plan');
    expect(ranges.map(([a, b]) => text.slice(a, b))).toEqual([
      'budget',
      'plan',
    ]);
  });

  it('decodes what the index escapes, and leaves other text alone', () => {
    const { text, ranges } = parseSnippet(
      '&lt;b&gt; is &quot;bold&quot;, it&#x27;s <b>x</b> &nbsp;',
    );
    expect(text).toBe('<b> is "bold", it\'s x &nbsp;');
    expect(ranges).toEqual([[20, 21]]);
  });

  it('is empty for an empty snippet', () => {
    expect(parseSnippet('')).toEqual({ text: '', ranges: [] });
  });
});

describe('isIndexUnavailable', () => {
  it('knows a node running with search off', () => {
    const err = Object.assign(new Error('FunctionCallError'), {
      data: 'search_query is only available in a view (#[app::view]) on a node with search',
    });
    expect(isIndexUnavailable(err)).toBe(true);
  });

  it('knows an app version without search_docs', () => {
    expect(
      isIndexUnavailable(
        Object.assign(new Error('rpc'), {
          data: { type: 'MethodNotFound', data: 'search_docs' },
        }),
      ),
    ).toBe(true);
    expect(
      isIndexUnavailable(new Error('method "search_docs" not found')),
    ).toBe(true);
  });

  it('does not take a network failure for it', () => {
    expect(isIndexUnavailable(new Error('Failed to fetch'))).toBe(false);
    expect(isIndexUnavailable(undefined)).toBe(false);
  });
});

describe('searchFolder', () => {
  it('asks for live docs and tags each hit with its folder', async () => {
    const { client: c, searchDocs } = client([page(['d1'])]);
    const hits = await searchFolder('f1', c, 'plan', 5);
    expect(searchDocs).toHaveBeenCalledWith({
      query: 'plan',
      include_archived: false,
      cursor: null,
      limit: 5,
    });
    expect(hits).toEqual([
      {
        folderId: 'f1',
        docId: 'd1',
        title: 'T d1',
        score: 1,
        snippet: 'the plan for d1',
        ranges: [[4, 8]],
      },
    ]);
  });
});

describe('folderMatches', () => {
  it('follows the cursor to the last page', async () => {
    const { client: c, searchDocs } = client([
      page(['a', 'b'], 2),
      page(['c']),
    ]);
    expect(await folderMatches(c, 'plan')).toEqual(['a', 'b', 'c']);
    expect(searchDocs).toHaveBeenLastCalledWith({
      query: 'plan',
      include_archived: true,
      cursor: 2,
      limit: NODE_FILTER_PAGE,
    });
  });

  it('stops after a bounded number of pages', async () => {
    const endless = {
      searchDocs: vi.fn(async () => page(['x'], 1)),
    } as unknown as DocsClient;
    const ids = await folderMatches(endless, 'plan');
    expect(ids.length).toBe(10);
  });
});

describe('blockOf', () => {
  const text: DocText = {
    folderId: 'f1',
    docId: 'd1',
    blocks: [
      { id: 'b0', kind: 'heading', text: 'Intro' },
      { id: 'b1', kind: 'paragraph', text: 'The Café opens', heading: 'Intro' },
    ],
    links: [],
    mentions: [],
  };
  const hit = {
    folderId: 'f1',
    docId: 'd1',
    title: 'Doc',
    score: 1,
    snippet: 'The cafe opens',
    ranges: [[4, 8]] as [number, number][],
  };

  it('finds the block the first matched word is in, folded', () => {
    expect(blockOf(hit, text)).toEqual({ id: 'b1', heading: 'Intro' });
  });

  it('has none without the doc read here, or without a match', () => {
    expect(blockOf(hit, undefined)).toBeUndefined();
    expect(blockOf({ ...hit, ranges: [] }, text)).toBeUndefined();
  });
});
