import { isHigh } from '../rich/offsets';

export const QUERY_MAX = 200; // longer input is cut so a paste cannot stall the palette
const TAGS_ONLY_PREFIX = '#';
const MARKS = /\p{M}/gu;
const FINAL_SIGMA = /ς/g; // lowercasing a whole string yields ς at word ends, per code point σ
const EMPTY_QUERY = /^[\p{P}\s]*$/u; // symbols such as emoji still count as a query
const WORD_CHAR = /[\p{L}\p{N}]/u;
const LABEL_WORDS = /[\p{L}\p{N}]+/gu;
const QUERY_SPACE = /\s+/u;
export const TYPO_TIER = 3; // below prefix 0, word start 1 and substring 2
const TYPO_MIN = 4; // code points a query word needs before a typo is forgiven

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
  const splitsPair = isHigh(s.charCodeAt(QUERY_MAX - 1));
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

/** The folded words of a query; a label must match every one. */
export function queryWords(query: string): string[] {
  return foldForSearch(query).split(QUERY_SPACE).filter(Boolean);
}

/** Every match of each query word as UTF-16 ranges on the original `text`, in text order, whole code points only. */
export function matchRanges(
  text: string,
  query: string,
  typos = true,
): [number, number][] {
  const words = queryWords(query);
  if (!words.length) return [];
  const { folded, starts, ends } = foldWithMap(text);
  const range = (from: number, length: number): [number, number] => [
    starts[from],
    ends[from + length - 1],
  ];
  const ranges = words.flatMap((q) => {
    const exact: [number, number][] = [];
    for (
      let i = folded.indexOf(q);
      i !== -1;
      i = folded.indexOf(q, i + q.length)
    )
      exact.push(range(i, q.length));
    const typed = Array.from(q);
    if (exact.length || !typos || typed.length < TYPO_MIN) return exact;
    return [...folded.matchAll(LABEL_WORDS)]
      .filter((w) => nearPrefix(typed, Array.from(w[0])))
      .map((w) => range(w.index, w[0].length));
  });
  return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * Null unless every word matches; lower is better: the worst word's tier, then the sum of tiers.
 * `folded` is foldForSearch output; the score stays below TYPO_TIER + 1.
 */
export function matchScore(
  folded: string,
  words: string[],
  typos = true,
): number | null {
  let worst = 0;
  let sum = 0;
  let labelWords: string[][] | undefined;
  for (const q of words) {
    let tier: number | null = exactTier(folded, q);
    const typed = tier === null && typos ? Array.from(q) : [];
    if (typed.length >= TYPO_MIN) {
      labelWords ??= (folded.match(LABEL_WORDS) ?? []).map((w) =>
        Array.from(w),
      );
      if (labelWords.some((w) => nearPrefix(typed, w))) tier = TYPO_TIER;
    }
    if (tier === null) return null;
    worst = Math.max(worst, tier);
    sum += tier;
  }
  // The other words only break ties, so one word scores its tier exactly.
  return worst + (sum - worst) / (TYPO_TIER * words.length + 1);
}

/** The exact rows when there are any: typo rows are only a fallback for when nothing matches exactly. */
export function typoFallback<T extends { typo?: boolean }>(rows: T[]): T[] {
  const exact = rows.filter((r) => !r.typo);
  return exact.length ? exact : rows;
}

/** `items` in their own order whose label matches every word of `query`; all of them for an empty query. */
export function filterByLabel<T>(
  items: T[],
  label: (item: T) => string,
  query: string,
): T[] {
  const words = queryWords(query);
  if (!words.length) return items;
  const hits = items.flatMap((item) => {
    const score = matchScore(foldForSearch(label(item)), words);
    return score === null ? [] : [{ item, typo: score >= TYPO_TIER }];
  });
  return typoFallback(hits).map((h) => h.item);
}

/** 0 prefix, 1 word start, 2 substring, null no match. */
function exactTier(folded: string, q: string): 0 | 1 | 2 | null {
  let best: 1 | 2 | null = null;
  for (let i = folded.indexOf(q); i !== -1; i = folded.indexOf(q, i + 1)) {
    if (i === 0) return 0;
    if (!WORD_CHAR.test(folded[i - 1])) return 1;
    best = 2;
  }
  return best;
}

/** True when `typed` is one edit (a swap of neighbours counts as one) from a prefix of `word` within one of its length. */
function nearPrefix(typed: string[], word: string[]): boolean {
  for (let len = typed.length - 1; len <= typed.length + 1; len++) {
    if (len <= word.length && withinOneEdit(typed, word.slice(0, len)))
      return true;
  }
  return false;
}

/** Optimal string alignment distance of at most 1. */
function withinOneEdit(a: string[], b: string[]): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length !== b.length) {
    const [long, short] = a.length > b.length ? [a, b] : [b, a];
    return sameFrom(long, i + 1, short, i);
  }
  if (i === a.length) return true;
  const swapped = a[i] === b[i + 1] && a[i + 1] === b[i];
  return (
    sameFrom(a, i + 1, b, i + 1) || (swapped && sameFrom(a, i + 2, b, i + 2))
  );
}

function sameFrom(a: string[], i: number, b: string[], j: number): boolean {
  if (a.length - i !== b.length - j) return false;
  for (; i < a.length; i++, j++) if (a[i] !== b[j]) return false;
  return true;
}
