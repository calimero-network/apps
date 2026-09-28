import { nameCollator } from '../collate';
import { docLabel } from '../docLabel';
import { folderLabel } from '../folderLabel';
import { sidebarTags, tagCounts } from '../tags';
import type { IndexRow, Tag } from '../workspaceIndex/types';
import {
  foldForSearch,
  matchRanges,
  matchScore,
  normalizeQuery,
} from './match';

const DEFAULT_LIMITS = { docs: 8, folders: 4, tags: 5 }; // rows per palette group

export type PaletteResult =
  | { kind: 'doc'; row: IndexRow; ranges: [number, number][] }
  | { kind: 'folder'; folderId: string; ranges: [number, number][] }
  | { kind: 'tag'; tag: Tag; count: number; ranges: [number, number][] };

/** Up to `limit` items whose label matches, best score first; `tieBreak` orders equal scores. */
function ranked<T>(
  items: T[],
  label: (item: T) => string,
  query: string,
  tieBreak: (a: T, b: T) => number,
  limit: number,
): { item: T; ranges: [number, number][] }[] {
  const folded = foldForSearch(query);
  return items
    .map((item) => ({
      item,
      score: matchScore(foldForSearch(label(item)), folded),
    }))
    .filter((m): m is { item: T; score: 0 | 1 | 2 } => m.score !== null)
    .sort((a, b) => a.score - b.score || tieBreak(a.item, b.item))
    .slice(0, limit)
    .map(({ item }) => ({ item, ranges: matchRanges(label(item), query) }));
}

/** Title search over the index: docs, then folders, then tags; `#` searches tags only. */
export function searchV1(
  q: string,
  rows: IndexRow[],
  folders: { id: string; name: string }[],
  tags: Tag[],
  limits = DEFAULT_LIMITS,
): PaletteResult[] {
  const { text, tagsOnly } = normalizeQuery(q);
  const counts = tagCounts(rows);
  const count = (t: Tag) => counts.get(t.key) ?? 0;
  const byCount = (a: Tag, b: Tag) =>
    count(b) - count(a) || nameCollator.compare(a.name, b.name);
  // A tag only on docs this member cannot read stays hidden, as in the sidebar.
  const liveTags = sidebarTags(tags, counts);
  const tagResult = (tag: Tag, ranges: [number, number][]): PaletteResult => ({
    kind: 'tag',
    tag,
    count: count(tag),
    ranges,
  });

  if (tagsOnly && !text) {
    return liveTags.map((t) => tagResult(t, []));
  }
  const tagHits = (limit: number) =>
    ranked(liveTags, (t) => t.name, text, byCount, limit).map((m) =>
      tagResult(m.item, m.ranges),
    );
  if (tagsOnly) return tagHits(Infinity);
  if (!text) return [];

  const docHits = ranked(
    rows.filter((r) => !r.archived),
    (r) => docLabel(r.title),
    text,
    (a, b) => b.updatedAt - a.updatedAt,
    limits.docs,
  );
  const folderHits = ranked(
    folders,
    (f) => folderLabel(f.name),
    text,
    (a, b) => nameCollator.compare(folderLabel(a.name), folderLabel(b.name)),
    limits.folders,
  );
  return [
    ...docHits.map(
      (m): PaletteResult => ({ kind: 'doc', row: m.item, ranges: m.ranges }),
    ),
    ...folderHits.map(
      (m): PaletteResult => ({
        kind: 'folder',
        folderId: m.item.id,
        ranges: m.ranges,
      }),
    ),
    ...tagHits(limits.tags),
  ];
}
