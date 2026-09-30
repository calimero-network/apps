// Search through each folder's `search_docs`: the node's full-text index of
// that docs context, which answers for every doc at once instead of this
// device reading each one. A node running with search off, or a folder on an
// app version without the view, cannot answer; the caller then falls back to
// the text it has read itself (`useTextIndex`).

import type { DocSearchHit, DocsClient } from '@/generated/docs/DocsClient';
import type { DocText } from '@/lib/workspaceIndex/types';
import { foldForSearch } from './match';

export const NODE_SEARCH_LIMIT = 20; // hits per folder the palette asks for
export const NODE_FILTER_PAGE = 100; // the most one call returns
export const NODE_FILTER_PAGES = 10; // a Home filter reads at most this many pages a folder

export type NodeHit = {
  folderId: string;
  docId: string;
  title: string;
  score: number;
  /** The snippet as plain text, and where the matched words are in it. */
  snippet: string;
  ranges: [number, number][];
};

/** Why a folder's search_docs did not answer. */
export type NodeMiss = 'unavailable' | 'failed';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#x27': "'",
};

/**
 * The index's snippet, HTML with the matched words in `<b>`, as the text a
 * reader sees and the ranges of the bold words in it.
 */
export function parseSnippet(html: string): {
  text: string;
  ranges: [number, number][];
} {
  let text = '';
  const ranges: [number, number][] = [];
  let start: number | null = null;
  const re = /<\/?b>|&(#x27|#39|amp|lt|gt|quot|apos);/g;
  let at = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    text += html.slice(at, m.index);
    at = m.index + m[0].length;
    if (m[0] === '<b>') start = text.length;
    else if (m[0] === '</b>') {
      if (start !== null && text.length > start)
        ranges.push([start, text.length]);
      start = null;
    } else text += ENTITIES[m[1]];
  }
  text += html.slice(at);
  return { text, ranges };
}

/** Every string an RPC error can carry its reason in, joined. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error && err.message) parts.push(err.message);
  if (err && typeof err === 'object') {
    for (const key of ['data', 'type', 'bodyText']) {
      const v = (err as Record<string, unknown>)[key];
      if (typeof v === 'string') parts.push(v);
      else if (v !== undefined) parts.push(JSON.stringify(v));
    }
  } else if (typeof err === 'string') parts.push(err);
  return parts.join(' | ');
}

/**
 * Whether `err` says this folder cannot answer from the index at all: the node
 * runs with search off, or the folder's app version has no `search_docs`.
 */
export function isIndexUnavailable(err: unknown): boolean {
  return /on a node with search|search needs a node|search_docs\W+not found|method not found|MethodNotFound/i.test(
    errorText(err),
  );
}

function toHit(folderId: string, hit: DocSearchHit): NodeHit {
  const { text, ranges } = parseSnippet(hit.snippet);
  return {
    folderId,
    docId: hit.id,
    title: hit.title,
    score: hit.score,
    snippet: text,
    ranges,
  };
}

/** One page of a folder's best matches. */
export async function searchFolder(
  folderId: string,
  client: DocsClient,
  query: string,
  limit = NODE_SEARCH_LIMIT,
): Promise<NodeHit[]> {
  const page = await client.searchDocs({
    query,
    include_archived: false,
    cursor: null,
    limit,
  });
  return page.hits.map((h) => toHit(folderId, h));
}

/** Every doc of a folder the index matches, up to `NODE_FILTER_PAGES` pages. */
export async function folderMatches(
  client: DocsClient,
  query: string,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < NODE_FILTER_PAGES; page++) {
    const res = await client.searchDocs({
      query,
      include_archived: true,
      cursor,
      limit: NODE_FILTER_PAGE,
    });
    ids.push(...res.hits.map((h) => h.id));
    cursor = res.next_cursor ?? null;
    if (cursor === null) break;
  }
  return ids;
}

/**
 * The block of `text` a hit's snippet came from, for opening the doc there:
 * the first block holding the snippet's first matched word. `undefined` when
 * the doc's text is not read on this device or the match is in the title.
 */
export function blockOf(
  hit: NodeHit,
  text: DocText | undefined,
): { id: string; heading?: string } | undefined {
  const [first] = hit.ranges;
  if (!text || !first) return undefined;
  const word = foldForSearch(hit.snippet.slice(first[0], first[1]));
  const block = text.blocks.find((b) => foldForSearch(b.text).includes(word));
  return block && { id: block.id, heading: block.heading };
}
