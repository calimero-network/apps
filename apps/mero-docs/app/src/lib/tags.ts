// A tag is a stable key on each doc; the registry maps the key to a name and a
// colour, so renames never touch docs and a deleted key is never reused.

import { nameCollator } from './collate';
import { foldForSearch, matchScore } from './search/match';
import type { IndexRow, Tag } from './workspaceIndex/types';

export type { Tag } from './workspaceIndex/types';

// One entry per colour, so a hex can never lose or swap its name. Order is the order new tags are assigned.
const TAG_PALETTE = [
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#8b5cf6', name: 'Purple' },
  { hex: '#10b981', name: 'Green' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#14b8a6', name: 'Teal' },
  { hex: '#64748b', name: 'Slate' },
] as const;

export const TAG_COLORS = TAG_PALETTE.map((c) => c.hex);
export const TAG_COLOR_NAMES = TAG_PALETTE.map((c) => c.name); // accessible names for the swatches, same order
export const TAG_NEUTRAL = '#94a3b8'; // fallback for a tag with no assigned colour
export const TAG_NAME_MAX = 32; // characters, not UTF-16 units
const TAG_KEY_MAX = 64; // mirrors the contract's TAG_KEY_MAX
const KEY_SUFFIX_ROOM = 6; // "-99999" still fits inside TAG_KEY_MAX
const RANDOM_KEY_PREFIX = 't-'; // for names with no latin letters or digits
const RANDOM_KEY_LEN = 6;
const RANDOM_KEY_RADIX = 36;
const RANDOM_KEY_TRIES = 8; // then number the last random key, so a stuck `random` still ends
const VALID_KEY = /^[a-z0-9-]+$/;
const SUGGESTIONS_MAX = 8; // the Add tag list stays short; typing narrows it

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
  let key = base || randomKey(random);
  for (let i = 1; !base && i < RANDOM_KEY_TRIES && taken.has(key); i++) {
    key = randomKey(random);
  }
  const stem = key;
  for (let n = 2; taken.has(key); n++) key = `${stem}-${n}`;
  return key;
}

export function isValidTagKey(key: string): boolean {
  return key.length <= TAG_KEY_MAX && VALID_KEY.test(key);
}

/** A doc's tag keys as chips named from the workspace tags; a deleted tag shows nowhere. */
export function docTagChips(
  keys: string[],
  byKey: Map<string, Tag>,
): { key: string; name: string; color?: string }[] {
  return keys.flatMap((key) => {
    const tag = byKey.get(key);
    if (tag?.deleted) return [];
    return [{ key, name: tag?.name ?? key, color: tag?.color }];
  });
}

/** Rows with deleted tags' keys dropped: a deleted tag shows nowhere, so it matches nothing either. */
export function withoutDeletedTags(
  rows: IndexRow[],
  byKey: Map<string, Tag>,
): IndexRow[] {
  return rows.map((r) =>
    r.tags.some((k) => byKey.get(k)?.deleted)
      ? { ...r, tags: r.tags.filter((k) => !byKey.get(k)?.deleted) }
      : r,
  );
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

/** Live tags matching `query`, not already in `exclude`: exact name, then prefix, then busiest. */
export function tagSuggestions(
  tags: Tag[],
  query: string,
  exclude: readonly string[],
  counts: Map<string, number>,
): Tag[] {
  const q = foldForSearch(normalizeTagName(query));
  const rank = (t: Tag) => {
    const name = foldForSearch(normalizeTagName(t.name));
    return name === q ? -1 : matchScore(name, q);
  };
  return tags
    .filter((t) => !t.deleted && !exclude.includes(t.key))
    .map((t) => ({ t, score: rank(t) }))
    .filter((x): x is { t: Tag; score: number } => x.score !== null)
    .sort(
      (a, b) =>
        a.score - b.score ||
        (counts.get(b.t.key) ?? 0) - (counts.get(a.t.key) ?? 0) ||
        nameCollator.compare(a.t.name, b.t.name),
    )
    .slice(0, SUGGESTIONS_MAX)
    .map((x) => x.t);
}

/** The colour a new tag starts with: the first one no live tag has yet. */
export function firstUnusedColor(tags: Tag[]): string {
  const used = new Set(tags.filter((t) => !t.deleted).map((t) => t.color));
  return TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[0];
}
