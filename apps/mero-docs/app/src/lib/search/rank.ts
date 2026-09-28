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
  queryWords,
  TYPO_TIER,
  typoFallback,
} from './match';

const DEFAULT_LIMITS = { docs: 8, folders: 4, tags: 5 }; // rows per palette group

type Match = { ranges: [number, number][]; typo: boolean }; // typo: found only by forgiving one

export type PaletteResult = Match &
  (
    | { kind: 'doc'; row: IndexRow }
    | { kind: 'folder'; folderId: string }
    | { kind: 'tag'; tag: Tag; count: number }
  );

/** Up to `limit` items whose label matches, best score first; `tieBreak` orders equal scores. */
function ranked<T>(
  items: T[],
  label: (item: T) => string,
  query: string,
  tieBreak: (a: T, b: T) => number,
  limit: number,
): (Match & { item: T })[] {
  const words = queryWords(query);
  return items
    .map((item) => ({
      item,
      score: matchScore(foldForSearch(label(item)), words),
    }))
    .filter((m): m is { item: T; score: number } => m.score !== null)
    .sort((a, b) => a.score - b.score || tieBreak(a.item, b.item))
    .slice(0, limit)
    .map(({ item, score }) => ({
      item,
      ranges: matchRanges(label(item), query),
      typo: score >= TYPO_TIER,
    }));
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
  const tagResult = (tag: Tag, match: Match): PaletteResult => ({
    kind: 'tag',
    tag,
    count: count(tag),
    ...match,
  });

  if (tagsOnly && !text) {
    return liveTags.map((t) => tagResult(t, { ranges: [], typo: false }));
  }
  const tagHits = (limit: number) =>
    ranked(liveTags, (t) => t.name, text, byCount, limit).map(
      ({ item, ...match }) => tagResult(item, match),
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
  return typoFallback([
    ...docHits.map(
      ({ item, ...match }): PaletteResult => ({
        kind: 'doc',
        row: item,
        ...match,
      }),
    ),
    ...folderHits.map(
      ({ item, ...match }): PaletteResult => ({
        kind: 'folder',
        folderId: item.id,
        ...match,
      }),
    ),
    ...tagHits(limits.tags),
  ]);
}
