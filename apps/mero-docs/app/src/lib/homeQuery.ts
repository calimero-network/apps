// The Home list's filters live in the URL, so a pasted link shows the same list.
// Parsing drops anything it does not understand; serializing is canonical.

import { nameCollator } from './collate';
import { docLabel } from './docLabel';
import { rowKey, type FolderInfo, type IndexRow } from './workspaceIndex/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const UPDATED_WINDOWS = ['1d', '7d', '30d'] as const; // 1d is "today", the others roll
const SORTS = ['updated', 'name', 'created'] as const;
const DEFAULT_SORT: HomeQuery['sort'] = 'updated';
const LIST_SEPARATOR = ',';

export type HomeQuery = {
  folders: string[];
  tags: string[];
  updated?: (typeof UPDATED_WINDOWS)[number];
  by?: string;
  archived: boolean;
  sort: (typeof SORTS)[number];
  view?: string;
};

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | null,
): T | undefined {
  return allowed.find((a) => a === value);
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function readList(search: URLSearchParams, key: string): string[] {
  return uniqueNonEmpty(
    search.getAll(key).flatMap((v) => v.split(LIST_SEPARATOR)),
  );
}

export function parseHomeQuery(search: URLSearchParams): HomeQuery {
  const q: HomeQuery = {
    folders: readList(search, 'folder'),
    tags: readList(search, 'tag'),
    archived: search.get('archived') === 'true',
    sort: oneOf(SORTS, search.get('sort')) ?? DEFAULT_SORT,
  };
  const updated = oneOf(UPDATED_WINDOWS, search.get('updated'));
  if (updated) q.updated = updated;
  const by = search.get('by');
  if (by) q.by = by;
  const view = search.get('view');
  if (view) q.view = view;
  return q;
}

/** The query string (no `?`) in canonical key order, defaults and blanks omitted. */
export function serializeHomeQuery(q: HomeQuery): string {
  const list = (values: string[]) =>
    uniqueNonEmpty(values).map(encodeURIComponent).join(LIST_SEPARATOR);
  const pairs: [string, string | undefined][] = [
    ['folder', list(q.folders)],
    ['tag', list(q.tags)],
    ['updated', q.updated],
    ['by', q.by && encodeURIComponent(q.by)],
    ['archived', q.archived ? 'true' : undefined],
    ['sort', q.sort === DEFAULT_SORT ? undefined : q.sort],
    ['view', q.view && encodeURIComponent(q.view)],
  ];
  return pairs
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/** Whether any real filter is on; a bare sort or a selected view is not one. */
export function isHomeQueryFiltered(q: HomeQuery): boolean {
  return (
    q.folders.length > 0 ||
    q.tags.length > 0 ||
    !!q.updated ||
    !!q.by ||
    q.archived
  );
}

/** A stored view's query with its id set as the selected view, in canonical order. */
export function withView(query: string, id: string): string {
  return serializeHomeQuery({
    ...parseHomeQuery(new URLSearchParams(query)),
    view: id,
  });
}

/** How many rows a saved view's stored query matches; 0, never a crash, for a stale filter (R-23). */
export function viewRowCount(
  rows: IndexRow[],
  folders: FolderInfo[],
  nowMs: number,
  query: string,
): number {
  return applyHomeQuery(
    rows,
    parseHomeQuery(new URLSearchParams(query)),
    nowMs,
    folders,
  ).length;
}

/** The tag whose page this query is: that one tag, no other filter, any sort. */
export function tagPageKey(q: HomeQuery): string | null {
  const onlyTag =
    q.tags.length === 1 &&
    q.folders.length === 0 &&
    !q.updated &&
    !q.by &&
    !q.archived;
  return onlyTag ? q.tags[0] : null;
}

function withDescendants(
  selected: string[],
  folders: FolderInfo[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId === undefined) continue;
    children.set(f.parentId, [...(children.get(f.parentId) ?? []), f.id]);
  }
  const out = new Set<string>();
  const stack = [...selected];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

function updatedSince(window: HomeQuery['updated'], nowMs: number): number {
  if (window === '1d') return new Date(nowMs).setHours(0, 0, 0, 0);
  return nowMs - (window === '7d' ? 7 : 30) * DAY_MS;
}

function compareBy(sort: HomeQuery['sort'], a: IndexRow, b: IndexRow): number {
  if (sort === 'name') {
    return nameCollator.compare(docLabel(a.title), docLabel(b.title));
  }
  if (sort === 'created') return b.createdAt - a.createdAt;
  return b.updatedAt - a.updatedAt;
}

/** The rows Home shows for `q`; a folder filter includes its subfolders. */
export function applyHomeQuery(
  rows: IndexRow[],
  q: HomeQuery,
  nowMs: number,
  folders: FolderInfo[],
): IndexRow[] {
  const inFolders = q.folders.length
    ? withDescendants(q.folders, folders)
    : null;
  const tags = new Set(q.tags);
  const since = q.updated ? updatedSince(q.updated, nowMs) : null;
  return rows
    .filter(
      (r) =>
        r.archived === q.archived &&
        (!inFolders || inFolders.has(r.folderId)) &&
        (!tags.size || r.tags.some((t) => tags.has(t))) &&
        (since === null || r.updatedAt >= since) &&
        (!q.by || r.createdBy === q.by),
    )
    .sort(
      (a, b) =>
        compareBy(q.sort, a, b) ||
        rowKey(a.folderId, a.docId).localeCompare(rowKey(b.folderId, b.docId)),
    );
}
