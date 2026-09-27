// A tag is a stable key on each doc; the registry maps the key to a name and a
// colour, so renames never touch docs and a deleted key is never reused.

import { foldForSearch } from './search/match';
import type { IndexRow, Tag } from './workspaceIndex/types';

export type { Tag } from './workspaceIndex/types';

export const TAG_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#ef4444',
  '#14b8a6',
  '#64748b',
] as const; // tag dots and fills only
export const TAG_NEUTRAL = '#94a3b8'; // a tag whose colour is unknown
export const TAG_NAME_MAX = 32; // characters, not UTF-16 units
const TAG_KEY_MAX = 64; // mirrors the contract's TAG_KEY_MAX
const KEY_SUFFIX_ROOM = 6; // "-99999" still fits inside TAG_KEY_MAX
const RANDOM_KEY_PREFIX = 't-'; // for names with no latin letters or digits
const RANDOM_KEY_LEN = 6;
const RANDOM_KEY_RADIX = 36;
const VALID_KEY = /^[a-z0-9-]+$/;
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'accent' });

/** Trimmed, inner whitespace collapsed, cut to TAG_NAME_MAX characters. */
export function normalizeTagName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return Array.from(collapsed).slice(0, TAG_NAME_MAX).join('').trimEnd();
}

/** The live tag with this name, ignoring case, accents and spacing. */
export function findTagByName(tags: Tag[], name: string): Tag | undefined {
  const folded = foldForSearch(normalizeTagName(name));
  if (!folded) return undefined;
  return tags.find(
    (t) => !t.deleted && foldForSearch(normalizeTagName(t.name)) === folded,
  );
}

function randomKey(random: () => number): string {
  let key = RANDOM_KEY_PREFIX;
  for (let i = 0; i < RANDOM_KEY_LEN; i++) {
    key += Math.floor(random() * RANDOM_KEY_RADIX).toString(RANDOM_KEY_RADIX);
  }
  return key;
}

/** A fresh key for a new tag; `taken` must include deleted keys so they never return. */
export function tagKeyFor(
  name: string,
  taken: ReadonlySet<string>,
  random: () => number = () => Math.random(),
): string {
  const base = foldForSearch(name)
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, TAG_KEY_MAX - KEY_SUFFIX_ROOM)
    .replace(/^-+|-+$/g, '');
  if (!base) {
    let key = randomKey(random);
    while (taken.has(key)) key = randomKey(random);
    return key;
  }
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}

export function isValidTagKey(key: string): boolean {
  return key.length <= TAG_KEY_MAX && VALID_KEY.test(key);
}

/** Docs per tag key, archived docs left out. */
export function tagCounts(rows: IndexRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.archived) continue;
    for (const key of r.tags) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Live tags that have docs, most used first, then by name. */
export function sidebarTags(tags: Tag[], counts: Map<string, number>): Tag[] {
  const count = (t: Tag) => counts.get(t.key) ?? 0;
  return tags
    .filter((t) => !t.deleted && count(t) > 0)
    .sort(
      (a, b) => count(b) - count(a) || nameCollator.compare(a.name, b.name),
    );
}
