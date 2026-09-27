import type { Block } from '@/generated/docs/DocsClient';
import { parseDocHref } from '../links';
import { rowKey, type DocText } from '../workspaceIndex/types';
import {
  foldForSearch,
  matchRanges,
  matchScore,
  normalizeQuery,
} from './match';

const HEADING_KIND = 'heading';
const SENTENCE_MAX = 160; // characters of context kept around a link
const SNIPPET_MAX = 90; // characters of context shown around a text match
const TEXT_LIMIT = 20; // docs listed in the "In document text" group
const ELLIPSIS = '…';
const SENTENCE_END = /[.!?](?=\s)/g;

type Link = DocText['links'][number];

/** A cut of a longer text: window index = original index - `offset`; `body` excludes the `…`. */
type TextWindow = { text: string; offset: number; body: [number, number] };

/** Up to `max` characters of `text` around [from, to), with `…` on cut sides. */
function windowAround(
  text: string,
  from: number,
  to: number,
  max: number,
): TextWindow {
  if (text.length <= max) return { text, offset: 0, body: [0, text.length] };
  const body = max - 2 * ELLIPSIS.length;
  let start = Math.floor((from + to - body) / 2);
  start = Math.max(0, Math.min(start, text.length - body));
  let end = start + body;
  if (isLowSurrogate(text.charCodeAt(start))) start++;
  if (isLowSurrogate(text.charCodeAt(end))) end--;
  const prefix = start > 0 ? ELLIPSIS : '';
  const suffix = end < text.length ? ELLIPSIS : '';
  return {
    text: prefix + text.slice(start, end) + suffix,
    offset: start - prefix.length,
    body: [prefix.length, prefix.length + end - start],
  };
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** `range` moved into window coordinates and clipped to the window's own text. */
function clip(
  [a, b]: [number, number],
  win: TextWindow,
): [number, number] | null {
  const from = Math.max(win.body[0], a - win.offset);
  const to = Math.min(win.body[1], b - win.offset);
  return from < to ? [from, to] : null;
}

/** The sentence of `text` holding [from, to), trimmed. */
function sentenceAround(
  text: string,
  from: number,
  to: number,
): [number, number] {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(SENTENCE_END)) {
    const stop = (m.index ?? 0) + 1;
    if (stop <= from) start = stop;
    else if (stop >= to) {
      end = stop;
      break;
    }
  }
  while (start < from && /\s/.test(text[start])) start++;
  while (end > to && /\s/.test(text[end - 1])) end--;
  return [start, end];
}

/** Runs of neighbouring spans that share one link href, as offsets in the block text. */
function linkRuns(block: Block): { href: string; from: number; to: number }[] {
  const runs: { href: string; from: number; to: number }[] = [];
  let at = 0;
  for (const span of block.spans) {
    const href = span.attributes.link;
    const last = runs[runs.length - 1];
    if (href && last?.href === href && last.to === at)
      last.to += span.text.length;
    else if (href) runs.push({ href, from: at, to: at + span.text.length });
    at += span.text.length;
  }
  return runs;
}

function linksIn(
  block: Block,
  section: string | undefined,
  text: string,
  origin: string,
): Link[] {
  return linkRuns(block).flatMap(({ href, from, to }) => {
    const target = parseDocHref(href, origin);
    if (!target) return [];
    const [start, end] = sentenceAround(text, from, to);
    const win = windowAround(
      text.slice(start, end),
      from - start,
      to - start,
      SENTENCE_MAX,
    );
    const link: Link = {
      target,
      blockId: block.id,
      sentence: win.text,
      linkRange: clip([from - start, to - start], win) ?? [0, 0],
    };
    return section === undefined ? [link] : [{ ...link, section }];
  });
}

/** A doc's block text, nearest headings and outgoing doc links, from `get_document` blocks. */
export function docTextFromBlocks(
  folderId: string,
  docId: string,
  blocks: Block[],
  origin: string,
): DocText {
  const out: DocText = { folderId, docId, blocks: [], links: [] };
  let heading: string | undefined;
  for (const block of blocks) {
    const text = block.spans.map((s) => s.text).join('');
    if (block.kind === HEADING_KIND) heading = text.trim() || undefined;
    out.blocks.push({
      id: block.id,
      kind: block.kind,
      text,
      ...(heading === undefined ? {} : { heading }),
    });
    out.links.push(...linksIn(block, heading, text, origin));
  }
  return out;
}

export type TextHit = {
  row: string;
  blockId: string;
  heading?: string;
  snippet: string;
  ranges: [number, number][];
};

/** The best matching block of each doc, best docs first; one row per doc. */
export function searchText(
  q: string,
  texts: Map<string, DocText>,
  limit = TEXT_LIMIT,
): TextHit[] {
  const { text: query, tagsOnly } = normalizeQuery(q);
  if (!query || tagsOnly) return [];
  const folded = foldForSearch(query);
  const best: {
    score: number;
    text: DocText;
    block: DocText['blocks'][number];
  }[] = [];
  for (const text of texts.values()) {
    let top: (typeof best)[number] | null = null;
    for (const block of text.blocks) {
      const score = matchScore(foldForSearch(block.text), folded);
      if (score !== null && (!top || score < top.score)) {
        top = { score, text, block };
        if (score === 0) break;
      }
    }
    if (top) best.push(top);
  }
  return best
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ text, block }) => {
      const ranges = matchRanges(block.text, query);
      const [first] = ranges.length ? ranges : [[0, 0] as [number, number]];
      const win = windowAround(block.text, first[0], first[1], SNIPPET_MAX);
      return {
        row: rowKey(text.folderId, text.docId),
        blockId: block.id,
        ...(block.heading === undefined ? {} : { heading: block.heading }),
        snippet: win.text,
        ranges: ranges
          .map((r) => clip(r, win))
          .filter((r): r is [number, number] => r !== null),
      };
    });
}
