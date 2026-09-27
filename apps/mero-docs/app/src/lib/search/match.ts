export const QUERY_MAX = 200; // longer input is cut so a paste cannot stall the palette
const TAGS_ONLY_PREFIX = '#';
const MARKS = /\p{M}/gu;
const FINAL_SIGMA = /ς/g; // lowercasing a whole string yields ς at word ends, per code point σ
const EMPTY_QUERY = /^[\p{P}\s]*$/u; // symbols such as emoji still count as a query
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Case, accent and width folded text; NFKD also maps full-width and ligature forms. */
export function foldForSearch(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(FINAL_SIGMA, 'σ')
    .replace(MARKS, '');
}

function cutToMax(s: string): string {
  if (s.length <= QUERY_MAX) return s;
  const last = s.charCodeAt(QUERY_MAX - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return s.slice(0, splitsPair ? QUERY_MAX - 1 : QUERY_MAX);
}

/** What the user typed, trimmed and capped; a leading `#` searches tags only. */
export function normalizeQuery(raw: string): {
  text: string;
  tagsOnly: boolean;
} {
  const trimmed = cutToMax(raw.trim()).trimEnd();
  const tagsOnly = trimmed.startsWith(TAGS_ONLY_PREFIX);
  const text = tagsOnly
    ? trimmed.slice(TAGS_ONLY_PREFIX.length).trim()
    : trimmed;
  return { text: EMPTY_QUERY.test(text) ? '' : text, tagsOnly };
}

/** Folded text plus, per folded code unit, the original code point it came from. */
function foldWithMap(text: string): {
  folded: string;
  starts: number[];
  ends: number[];
} {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const cp of text) {
    const f = foldForSearch(cp);
    const end = at + cp.length;
    if (f) {
      folded += f;
      for (let i = 0; i < f.length; i++) {
        starts.push(at);
        ends.push(end);
      }
    } else if (ends.length) {
      // A combining mark belongs to the character before it.
      for (let i = ends.length - 1; i >= 0 && ends[i] === at; i--)
        ends[i] = end;
    }
    at = end;
  }
  return { folded, starts, ends };
}

/** Every match of `query` as UTF-16 ranges on the original `text`, whole code points only. */
export function matchRanges(text: string, query: string): [number, number][] {
  const q = foldForSearch(query);
  if (!q) return [];
  const { folded, starts, ends } = foldWithMap(text);
  const ranges: [number, number][] = [];
  for (
    let i = folded.indexOf(q);
    i !== -1;
    i = folded.indexOf(q, i + q.length)
  ) {
    ranges.push([starts[i], ends[i + q.length - 1]]);
  }
  return ranges;
}

/** 0 prefix, 1 word start, 2 substring, null no match; both inputs already folded. */
export function matchScore(
  folded: string,
  foldedQuery: string,
): 0 | 1 | 2 | null {
  let best: 1 | 2 | null = null;
  for (
    let i = folded.indexOf(foldedQuery);
    i !== -1;
    i = folded.indexOf(foldedQuery, i + 1)
  ) {
    if (i === 0) return 0;
    if (!WORD_CHAR.test(folded[i - 1])) return 1;
    best = 2;
  }
  return best;
}
