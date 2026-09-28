// The search palette on live data: recent docs before anything is typed, then
// titles, folders and tags from the workspace index and matches inside docs.

import * as React from 'react';
import { ArrowRight } from 'lucide-react';

import { hereLabel, LivePill } from '@/components/common/LivePill';
import { FolderPath } from '@/components/home/DocTable';
import { useFolderPaths } from '@/components/home/useHomeChips';
import { TagChip } from '@/components/tags/TagChip';
import {
  useTextIndexValue,
  useWorkspaceIndexValue,
} from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { usePresenceByDoc } from '@/hooks/usePresenceByDoc';
import { liveRecent, type RecentDoc } from '@/hooks/useRecentDocs';
import { useTags } from '@/hooks/useTags';
import type { AppRoute } from '@/lib/routes';
import { docLabel } from '@/lib/docLabel';
import { folderLabel } from '@/lib/folderLabel';
import { parseHomeQuery, serializeHomeQuery } from '@/lib/homeQuery';
import { namespaceLabel } from '@/lib/namespaceLabel';
import { openedLabel, updatedLabel } from '@/lib/relativeTime';
import { normalizeQuery } from '@/lib/search/match';
import { searchV1 } from '@/lib/search/rank';
import { searchText } from '@/lib/search/docText';
import { rowKey, type IndexRow } from '@/lib/workspaceIndex/types';

import {
  SearchPalette,
  SearchProgress,
  type OpenOptions,
} from './SearchPalette';
import type { PaletteGroupView, PaletteItemView } from './types';

const TEXT_DEBOUNCE_MS = 80; // body text waits for a typing pause; titles never do
const TIP_TAGS = 3; // tag chips shown under the "#" tip
const EMPTY_TEXT = 'No documents, folders or tags match';
const TAGS_TIP = 'Type # to search tags only';

type Target =
  | { kind: 'doc'; folderId: string; docId: string; block?: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'tag'; key: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recent: RecentDoc[];
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

// Folder names in bold, joined as a sentence: "Finance, Legal and Ops".
function folderList(names: string[]): React.ReactNode {
  return names.map((name, i) => (
    <React.Fragment key={i}>
      {i === 0 ? '' : i === names.length - 1 ? ' and ' : ', '}
      <b className="font-semibold">{name}</b>
    </React.Fragment>
  ));
}

function coverageWarning(
  syncing: string[],
  failed: string[],
): React.ReactNode | undefined {
  if (!syncing.length && !failed.length) return undefined;
  const one = syncing.length === 1;
  return (
    <>
      {syncing.length > 0 && (
        <>
          {folderList(syncing)}
          {one
            ? ' is still syncing, so it was not searched yet.'
            : ' are still syncing, so they were not searched yet.'}
        </>
      )}
      {syncing.length > 0 && failed.length > 0 && ' '}
      {failed.length > 0 && <>{folderList(failed)} could not be searched.</>}
    </>
  );
}

// Parts of a row's second line, with the mockup's middle dots between them.
function dotted(...parts: React.ReactNode[]): React.ReactNode {
  return parts
    .filter((p) => p !== null && p !== undefined && p !== false)
    .map((p, i) => (
      <React.Fragment key={i}>
        {i > 0 && ' · '}
        {p}
      </React.Fragment>
    ));
}

export function SearchContainer({ open, onOpenChange, recent }: Props) {
  const { rows, folders, folderStatus } = useWorkspaceIndexValue();
  const { texts, foldersDone, foldersTotal } = useTextIndexValue();
  const { tags, byKey: tagsByKey } = useTags();
  const presence = usePresenceByDoc();
  const { namespaceId, namespaces } = useDriveWorkspace();
  const { href, goDoc, goFolder, goHome } = useAppRoute();
  const paths = useFolderPaths(folders);
  const [query, setQuery] = React.useState('');
  const textQuery = useDebounced(query, TEXT_DEBOUNCE_MS);

  const scopeLabel = namespaceLabel(
    namespaces.find((n) => n.namespaceId === namespaceId)?.name,
  );

  const { groups, targets, warning } = React.useMemo(() => {
    const targets = new Map<string, Target>();
    const groups: PaletteGroupView[] = [];
    if (!open) return { groups, targets, warning: undefined };
    const now = Date.now();
    const live = new Map(
      rows
        .filter((r) => !r.archived)
        .map((r) => [rowKey(r.folderId, r.docId), r]),
    );
    const folderPath = (folderId: string) => {
      const path = paths.get(folderId);
      return <FolderPath path={path?.names ?? []} color={path?.color} />;
    };
    const livePill = (key: string) => {
      const label = hereLabel(presence.get(key) ?? []);
      return label ? <LivePill label={label} /> : undefined;
    };
    const docItem = (
      id: string,
      kind: PaletteItemView['kind'],
      r: IndexRow,
      extra: Partial<PaletteItemView>,
      block?: string,
    ): PaletteItemView => {
      targets.set(id, {
        kind: 'doc',
        folderId: r.folderId,
        docId: r.docId,
        block,
      });
      return {
        id,
        kind,
        title: docLabel(r.title),
        right: livePill(rowKey(r.folderId, r.docId)),
        ...extra,
      };
    };

    const { text, tagsOnly } = normalizeQuery(query);
    if (!text && !tagsOnly) {
      const recentItems = liveRecent(recent, rows).map(({ entry, row: r }) =>
        docItem(`recent:${rowKey(r.folderId, r.docId)}`, 'recent', r, {
          context: dotted(
            folderPath(r.folderId),
            openedLabel(entry.openedAt, now),
          ),
        }),
      );
      const topTags = searchV1('#', rows, [], tags).slice(0, TIP_TAGS);
      groups.push(
        { id: 'recent', label: 'Recent', items: recentItems },
        {
          id: 'tips',
          label: 'Tips',
          items: [
            {
              id: 'tip:tags',
              kind: 'tip',
              title: TAGS_TIP,
              context: topTags.length
                ? topTags.flatMap((t) =>
                    t.kind === 'tag'
                      ? [
                          <TagChip
                            key={t.tag.key}
                            name={t.tag.name}
                            color={t.tag.color}
                          />,
                        ]
                      : [],
                  )
                : undefined,
            },
          ],
        },
      );
      return { groups, targets, warning: undefined };
    }

    const docs: PaletteItemView[] = [];
    const folderItems: PaletteItemView[] = [];
    const tagItems: PaletteItemView[] = [];
    for (const result of searchV1(query, rows, folders, tags)) {
      if (result.kind === 'doc') {
        const r = result.row;
        const chips = r.tags.flatMap((k) => {
          const t = tagsByKey.get(k);
          return t?.deleted
            ? []
            : [<TagChip key={k} name={t?.name ?? k} color={t?.color} />];
        });
        docs.push(
          docItem(`doc:${rowKey(r.folderId, r.docId)}`, 'doc', r, {
            titleRanges: result.ranges,
            context: dotted(
              folderPath(r.folderId),
              chips.length ? chips : null,
              updatedLabel(r.updatedAt, now),
            ),
          }),
        );
      } else if (result.kind === 'folder') {
        const id = `folder:${result.folderId}`;
        const path = paths.get(result.folderId);
        const parents = path?.names.slice(0, -1) ?? [];
        targets.set(id, { kind: 'folder', folderId: result.folderId });
        folderItems.push({
          id,
          kind: 'folder',
          title: folderLabel(
            folders.find((f) => f.id === result.folderId)?.name,
          ),
          titleRanges: result.ranges,
          context: parents.length ? (
            <FolderPath path={parents} color={path?.color} />
          ) : undefined,
        });
      } else {
        const id = `tag:${result.tag.key}`;
        targets.set(id, { kind: 'tag', key: result.tag.key });
        tagItems.push({
          id,
          kind: 'tag',
          title: `#${result.tag.name}`,
          titleRanges: result.ranges.map(([a, b]) => [a + 1, b + 1]),
          tagColor: result.tag.color,
          context: `${plural(result.count, 'document')} · show them all on Home`,
          right: <ArrowRight className="h-3.5 w-3.5" aria-hidden />,
        });
      }
    }
    groups.push(
      { id: 'docs', label: 'Documents', items: docs },
      { id: 'folders', label: 'Folders', items: folderItems },
      { id: 'tags', label: 'Tags', items: tagItems },
    );

    if (!tagsOnly) {
      const hits = searchText(textQuery, texts).flatMap((hit) => {
        const r = live.get(hit.row);
        if (!r) return [];
        return [
          docItem(
            `text:${hit.row}`,
            'text',
            r,
            {
              context: dotted(
                folderPath(r.folderId),
                hit.heading === undefined ? null : `in “${hit.heading}”`,
              ),
              snippet: hit.snippet,
              snippetRanges: hit.ranges,
            },
            hit.blockId,
          ),
        ];
      });
      groups.push({
        id: 'text',
        label: 'In document text',
        items: hits,
        aside:
          foldersDone < foldersTotal ? (
            <SearchProgress
              label={`${foldersDone} of ${foldersTotal} folders searched`}
            />
          ) : undefined,
      });
    }

    // Only member folders are in the index, so a restricted folder is never named.
    const named = (status: string) =>
      folders
        .filter((f) => folderStatus[f.id] === status)
        .map((f) => folderLabel(f.name));
    return {
      groups,
      targets,
      warning: coverageWarning(named('syncing'), named('error')),
    };
  }, [
    open,
    query,
    textQuery,
    rows,
    folders,
    folderStatus,
    tags,
    tagsByKey,
    texts,
    foldersDone,
    foldersTotal,
    presence,
    recent,
    paths,
  ]);

  const routeOf = (t: Target): { route: AppRoute; search?: string } => {
    const ws = namespaceId ?? '';
    if (t.kind === 'doc')
      return {
        route: { ws, folder: t.folderId, doc: t.docId, block: t.block },
      };
    if (t.kind === 'folder') return { route: { ws, folder: t.folderId } };
    return {
      route: { ws },
      search: serializeHomeQuery({
        ...parseHomeQuery(new URLSearchParams()),
        tags: [t.key],
      }),
    };
  };

  const onOpen = (item: PaletteItemView, { newTab }: OpenOptions) => {
    const target = targets.get(item.id);
    if (!target) return;
    if (newTab) {
      const { route, search } = routeOf(target);
      window.open(href(route, search), '_blank', 'noopener');
      return;
    }
    onOpenChange(false);
    if (target.kind === 'doc')
      goDoc(target.folderId, target.docId, { block: target.block });
    else if (target.kind === 'folder') goFolder(target.folderId);
    else goHome(routeOf(target).search);
  };

  return (
    <SearchPalette
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQueryChange={setQuery}
      scopeLabel={scopeLabel}
      groups={groups}
      warning={warning}
      emptyText={EMPTY_TEXT}
      onOpen={onOpen}
    />
  );
}
