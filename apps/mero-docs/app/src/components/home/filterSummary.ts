// The chips a saved view's popover shows for the active filters, and a
// starting name built from them, so a save has something better than "Untitled".

import type { HomeQuery } from '@/lib/homeQuery';
import { cutViewName } from '@/lib/viewName';
import { TAG_NEUTRAL } from '@/lib/tags';
import type { Tag } from '@/lib/workspaceIndex/types';
import {
  MENTIONED_ME_LABEL,
  UNKNOWN_TAG_LABEL,
  type FolderPaths,
} from './useHomeChips';
import { UPDATED_OPTIONS } from './UpdatedMenu';
import type { FilterIcon } from './types';

const UNKNOWN_FOLDER_LABEL = 'Unknown folder';

export const SORT_LABELS: Record<HomeQuery['sort'], string> = {
  updated: 'Last updated',
  name: 'Name',
  created: 'Created',
};

export type FilterSummary = {
  icon: FilterIcon | 'sort';
  label: string;
  color?: string;
};

interface Args {
  q: HomeQuery;
  tagsByKey: Map<string, Tag>;
  paths: FolderPaths;
  personName: (id: string) => string;
  sortLabel: string;
}

/** Every active filter, as the popover shows it, with the sort always last. */
export function summarizeHomeQuery({
  q,
  tagsByKey,
  paths,
  personName,
  sortLabel,
}: Args): FilterSummary[] {
  const items: FilterSummary[] = [
    ...q.folders.map((id) => ({
      icon: 'folder' as const,
      label: paths.get(id)?.names.join(' / ') ?? UNKNOWN_FOLDER_LABEL,
    })),
    ...q.tags.map((key) => {
      const tag = tagsByKey.get(key);
      return {
        icon: 'tag' as const,
        label: tag && !tag.deleted ? tag.name : UNKNOWN_TAG_LABEL,
        color: tag?.color ?? TAG_NEUTRAL,
      };
    }),
  ];
  if (q.updated) {
    items.push({
      icon: 'calendar',
      label:
        UPDATED_OPTIONS.find((o) => o.value === q.updated)?.label ??
        q.updated,
    });
  }
  if (q.by) {
    items.push({ icon: 'user', label: personName(q.by) });
  }
  if (q.mentions) items.push({ icon: 'mention', label: MENTIONED_ME_LABEL });
  if (q.archived) items.push({ icon: 'archive', label: 'Archived' });
  items.push({ icon: 'sort', label: sortLabel });
  return items;
}

/** A starting name from the active filters, e.g. a lone tag's name, cut to the name limit. */
export function defaultViewName(args: Args): string {
  const parts = summarizeHomeQuery(args).filter((s) => s.icon !== 'sort');
  return parts.length
    ? cutViewName(parts.map((p) => p.label).join(', '))
    : 'New view';
}
