// The filter chips over the Home list, each with its popover; every change goes
// through `setQuery`, so the URL stays the only filter state.

import * as React from 'react';

import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { usePersonName } from '@/hooks/usePersonName';
import { useTags } from '@/hooks/useTags';
import { nameCollator } from '@/lib/collate';
import { folderLabel } from '@/lib/folderLabel';
import type { HomeQuery } from '@/lib/homeQuery';
import { sidebarTags, TAG_NEUTRAL } from '@/lib/tags';
import type { FolderInfo, IndexRow } from '@/lib/workspaceIndex/types';
import { FilterChecklist } from './FilterChecklist';
import { UPDATED_OPTIONS, UpdatedMenu } from './UpdatedMenu';
import type { FilterChipView } from './types';

export const UNKNOWN_TAG_LABEL = 'Unknown tag';
export const UNKNOWN_FOLDER_LABEL = 'Unknown folder';

export type FolderPaths = Map<
  string,
  { names: string[]; color?: string; ids: string[] }
>;

function toggled(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function countBy(rows: IndexRow[], keysOf: (r: IndexRow) => string[]) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const k of keysOf(r)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** A chip naming the first pick, "+N" for the rest. */
function listChipLabel(noun: string, names: string[], unknown: string) {
  if (names.length === 1 && names[0] === unknown) return unknown;
  const more = names.length > 1 ? ` +${names.length - 1}` : '';
  return `${noun}: ${names[0]}${more}`;
}

/** Each folder's names and ids from the root, and its colour, else its nearest ancestor's. */
export function useFolderPaths(folders: FolderInfo[]): FolderPaths {
  return React.useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const chain = (id: string): FolderInfo[] => {
      const out: FolderInfo[] = [];
      let f = byId.get(id);
      while (f && !out.includes(f)) {
        out.unshift(f);
        f = f.parentId ? byId.get(f.parentId) : undefined;
      }
      return out;
    };
    const paths = new Map<
      string,
      { names: string[]; color?: string; ids: string[] }
    >();
    for (const f of folders) {
      const c = chain(f.id);
      paths.set(f.id, {
        names: c.map((x) => folderLabel(x.name)),
        color: [...c].reverse().find((x) => x.color)?.color,
        ids: c.map((x) => x.id),
      });
    }
    return paths;
  }, [folders]);
}

interface Args {
  q: HomeQuery;
  folderId?: string; // a folder route has no Folder chip
  setQuery: (next: HomeQuery) => void;
  folders: FolderInfo[];
  paths: FolderPaths;
  base: IndexRow[]; // the rows the counts are taken over
}

export function useHomeChips({
  q,
  folderId,
  setQuery,
  folders,
  paths,
  base,
}: Args): FilterChipView[] {
  const { selfIdentity, registryFolders } = useDriveWorkspace();
  const { tags, byKey: tagsByKey } = useTags();
  const personName = usePersonName(q.by);
  const tagName = (key: string) => {
    const t = tagsByKey.get(key);
    return t && !t.deleted ? t.name : UNKNOWN_TAG_LABEL;
  };
  // A folder this member cannot see keeps the alias its no-access card shows.
  const folderName = (id: string) => {
    const hidden = registryFolders?.find((f) => f.id === id);
    return (
      paths.get(id)?.names.join(' / ') ??
      (hidden ? folderLabel(hidden.alias) : UNKNOWN_FOLDER_LABEL)
    );
  };
  const [openChip, setOpenChip] = React.useState<string | null>(null);

  const folderCounts = countBy(base, (r) => paths.get(r.folderId)?.ids ?? []);
  const folderItems = [...folders]
    .map((f) => ({ id: f.id, label: folderName(f.id) }))
    .sort((a, b) => nameCollator.compare(a.label, b.label))
    .map((f) => ({
      ...f,
      count: folderCounts.get(f.id) ?? 0,
      checked: q.folders.includes(f.id),
    }));

  const tagCountsInBase = countBy(base, (r) => r.tags);
  const listedTags = sidebarTags(tags, tagCountsInBase);
  const tagItems = [
    ...listedTags.map((t) => ({ id: t.key, label: t.name, dotColor: t.color })),
    ...q.tags
      .filter((k) => !listedTags.some((t) => t.key === k))
      .map((k) => ({
        id: k,
        label: tagName(k),
        dotColor: tagsByKey.get(k)?.color ?? TAG_NEUTRAL,
      })),
  ].map((t) => ({
    ...t,
    count: tagCountsInBase.get(t.id) ?? 0,
    checked: q.tags.includes(t.id),
  }));

  const byCounts = countBy(base, (r) => [r.createdBy]);
  const people = [...new Set([...byCounts.keys(), ...(q.by ? [q.by] : [])])]
    .map((id) => ({ id, label: personName(id) }))
    .sort((a, b) =>
      a.id === selfIdentity
        ? -1
        : b.id === selfIdentity
          ? 1
          : nameCollator.compare(a.label, b.label),
    )
    .map((p) => ({
      ...p,
      count: byCounts.get(p.id) ?? 0,
      checked: q.by === p.id,
    }));

  const chips: FilterChipView[] = [
    ...(folderId
      ? []
      : [
          {
            id: 'folder',
            icon: 'folder' as const,
            label: q.folders.length
              ? listChipLabel(
                  'Folder',
                  q.folders.map(folderName),
                  UNKNOWN_FOLDER_LABEL,
                )
              : 'Folder',
            active: q.folders.length > 0,
            onClear: () => setQuery({ ...q, folders: [] }),
            popover: (
              <FilterChecklist
                placeholder="Filter folders"
                items={folderItems}
                onToggle={(id) =>
                  setQuery({ ...q, folders: toggled(q.folders, id) })
                }
                onClear={() => setQuery({ ...q, folders: [] })}
                footerHint="Includes subfolders"
              />
            ),
          },
        ]),
    {
      id: 'tag',
      icon: 'tag',
      label: q.tags.length
        ? listChipLabel('Tag', q.tags.map(tagName), UNKNOWN_TAG_LABEL)
        : 'Tag',
      active: q.tags.length > 0,
      onClear: () => setQuery({ ...q, tags: [] }),
      popover: (
        <FilterChecklist
          placeholder="Filter tags"
          items={tagItems}
          onToggle={(id) => setQuery({ ...q, tags: toggled(q.tags, id) })}
          onClear={() => setQuery({ ...q, tags: [] })}
          footerHint="Match any selected tag"
        />
      ),
    },
    {
      id: 'updated',
      icon: 'calendar',
      label: q.updated
        ? `Updated: ${UPDATED_OPTIONS.find((o) => o.value === q.updated)?.label}`
        : 'Updated',
      active: !!q.updated,
      onClear: () => setQuery({ ...q, updated: undefined }),
      popover: (
        <UpdatedMenu
          value={q.updated}
          onChange={(updated) => {
            setOpenChip(null);
            setQuery({ ...q, updated });
          }}
        />
      ),
      open: openChip === 'updated',
      onOpenChange: (open) => setOpenChip(open ? 'updated' : null),
    },
    {
      id: 'by',
      icon: 'user',
      label: q.by ? `Created by: ${personName(q.by)}` : 'Created by',
      active: !!q.by,
      onClear: () => setQuery({ ...q, by: undefined }),
      popover: (
        <FilterChecklist
          placeholder="Filter people"
          items={people}
          onToggle={(id) =>
            setQuery({ ...q, by: q.by === id ? undefined : id })
          }
          onClear={() => setQuery({ ...q, by: undefined })}
          footerHint="Pick one person"
        />
      ),
    },
    {
      id: 'archived',
      icon: 'archive',
      label: 'Archived',
      active: q.archived,
      toggle: true,
      onToggle: () => setQuery({ ...q, archived: !q.archived }),
    },
  ];
  return chips;
}
