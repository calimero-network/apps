// The search palette on live data: recent docs before anything is typed, then
// titles, folders and tags from the workspace index and matches inside docs.

import * as React from 'react';
import { ArrowRight, AtSign } from 'lucide-react';

import { hereLabel, LivePill } from '@/components/common/LivePill';
import { FolderPath } from '@/components/home/DocTable';
import {
  useFolderPaths,
  type FolderPaths,
} from '@/components/home/useHomeChips';
import { TagChip } from '@/components/tags/TagChip';
import {
  useTextIndexValue,
  useWorkspaceIndexValue,
} from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useMentionedMe } from '@/hooks/useMentionedMe';
import { usePresenceByDoc, type PresenceByDoc } from '@/hooks/usePresenceByDoc';
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
const MENTIONS_QUERY = '@me'; // lists the docs that mention you, instead of a search
const MENTIONS_TIP = `Type ${MENTIONS_QUERY} for documents that mention you`;
const NO_MENTIONS = 'No documents mention you yet';

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

// One sentence per reason a member folder is missing from the results.
function coverageWarning(
  syncing: string[],
  failed: string[],
  partial: string[],
): React.ReactNode | undefined {
  const sentences: React.ReactNode[] = [];
  if (syncing.length)
    sentences.push(
      <>
        {folderList(syncing)}
        {syncing.length === 1
          ? ' is still syncing, so it was not searched yet.'
          : ' are still syncing, so they were not searched yet.'}
      </>,
    );
  if (failed.length)
    sentences.push(<>{folderList(failed)} could not be searched.</>);
  if (partial.length)
    sentences.push(<>{folderList(partial)} could not be fully searched.</>);
  if (!sentences.length) return undefined;
  return sentences.map((sentence, i) => (
    <React.Fragment key={i}>
      {i > 0 && ' '}
      {sentence}
    </React.Fragment>
  ));
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

type RowContext = {
  paths: FolderPaths;
  presence: PresenceByDoc;
  targets: Map<string, Target>;
};

function folderPathOf(paths: FolderPaths, folderId: string): React.ReactNode {
  const path = paths.get(folderId);
  return <FolderPath path={path?.names ?? []} color={path?.color} />;
}

// A doc row: its label, the live pill, and where it opens.
function docItem(
  ctx: RowContext,
  id: string,
  kind: PaletteItemView['kind'],
  r: IndexRow,
  extra: Partial<PaletteItemView>,
  block?: string,
): PaletteItemView {
  ctx.targets.set(id, {
    kind: 'doc',
    folderId: r.folderId,
    docId: r.docId,
    block,
  });
  const label = hereLabel(ctx.presence.get(rowKey(r.folderId, r.docId)) ?? []);
  return {
    id,
    kind,
    title: docLabel(r.title),
    right: label ? <LivePill label={label} /> : undefined,
    ...extra,
  };
}

export function SearchContainer({ open, onOpenChange, recent }: Props) {
  const { rows, folders, folderStatus } = useWorkspaceIndexValue();
  const {
    texts,
    foldersDone,
    foldersTotal,
    failed: partlyRead,
  } = useTextIndexValue();
  const { tags, byKey: tagsByKey } = useTags();
  const { mentions, reading: mentionsReading } = useMentionedMe();
  const presence = usePresenceByDoc();
  const { namespaceId, namespaces } = useDriveWorkspace();
  const { href, goDoc, goFolder, goHome } = useAppRoute();
  const paths = useFolderPaths(folders);
  const [query, setQuery] = React.useState('');
  const textQuery = useDebounced(query, TEXT_DEBOUNCE_MS);

  const scopeLabel = namespaceLabel(
    namespaces.find((n) => n.namespaceId === namespaceId)?.name,
  );
  const live = React.useMemo(
    () =>
      new Map(
        rows
          .filter((r) => !r.archived)
          .map((r) => [rowKey(r.folderId, r.docId), r]),
      ),
    [rows],
  );

  // Recents, or title, folder and tag matches: from memory on every keystroke.
  const titles = React.useMemo(() => {
    const ctx: RowContext = { paths, presence, targets: new Map() };
    const groups: PaletteGroupView[] = [];
    const { text, tagsOnly } = normalizeQuery(query);
    const empty = !text && !tagsOnly;
    const mentionsOnly = text.toLowerCase() === MENTIONS_QUERY;
    const base = { ...ctx, groups, tagsOnly, empty, mentionsOnly };
    if (!open) return { ...base, warning: undefined };
    const now = Date.now();
    // Only member folders are in the index, so a restricted folder is never named.
    const named = (ids: string[]) =>
      folders.filter((f) => ids.includes(f.id)).map((f) => folderLabel(f.name));

    if (mentionsOnly) {
      const items = [...mentions]
        .flatMap(([key, m]) => {
          const r = live.get(key);
          return r ? [{ r, m }] : [];
        })
        .sort((a, b) => b.r.updatedAt - a.r.updatedAt)
        .map(({ r, m }) =>
          docItem(
            ctx,
            `mention:${rowKey(r.folderId, r.docId)}`,
            'text',
            r,
            { context: folderPathOf(paths, r.folderId), snippet: m.sentence },
            m.blockId,
          ),
        );
      groups.push({ id: 'mentions', label: 'Mentions', items });
      return { ...base, warning: coverageWarning([], [], named(partlyRead)) };
    }

    if (empty) {
      const recentItems = liveRecent(recent, rows).map(({ entry, row: r }) =>
        docItem(ctx, `recent:${rowKey(r.folderId, r.docId)}`, 'recent', r, {
          context: dotted(
            folderPathOf(paths, r.folderId),
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
            {
              id: 'tip:mentions',
              kind: 'tip',
              title: MENTIONS_TIP,
              icon: AtSign,
            },
          ],
        },
      );
      return { ...base, warning: undefined };
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
          docItem(ctx, `doc:${rowKey(r.folderId, r.docId)}`, 'doc', r, {
            titleRanges: result.ranges,
            context: dotted(
              folderPathOf(paths, r.folderId),
              chips.length ? chips : null,
              updatedLabel(r.updatedAt, now),
            ),
          }),
        );
      } else if (result.kind === 'folder') {
        const id = `folder:${result.folderId}`;
        const path = paths.get(result.folderId);
        const parents = path?.names.slice(0, -1) ?? [];
        ctx.targets.set(id, { kind: 'folder', folderId: result.folderId });
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
        ctx.targets.set(id, { kind: 'tag', key: result.tag.key });
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

    const withStatus = (status: string) =>
      folders.filter((f) => folderStatus[f.id] === status).map((f) => f.id);
    const warning = coverageWarning(
      named(withStatus('syncing')),
      named(withStatus('error')),
      named(partlyRead),
    );
    return { ...base, warning };
  }, [
    live,
    mentions,
    open,
    query,
    rows,
    folders,
    folderStatus,
    tags,
    tagsByKey,
    presence,
    recent,
    paths,
    partlyRead,
  ]);

  // Matches inside doc text: a scan of every indexed block, so only once typing pauses.
  const textHits = React.useMemo(() => {
    const ctx: RowContext = { paths, presence, targets: new Map() };
    if (!open || !normalizeQuery(textQuery).text) return { ...ctx, items: [] };
    const items = searchText(textQuery, texts).flatMap((hit) => {
      const r = live.get(hit.row);
      if (!r) return [];
      return [
        docItem(
          ctx,
          `text:${hit.row}`,
          'text',
          r,
          {
            context: dotted(
              folderPathOf(paths, r.folderId),
              hit.heading === undefined ? null : `in “${hit.heading}”`,
            ),
            snippet: hit.snippet,
            snippetRanges: hit.ranges,
          },
          hit.blockId,
        ),
      ];
    });
    return { ...ctx, items };
  }, [open, textQuery, texts, live, paths, presence]);

  // Still reading a folder, not merely missing one that failed.
  const reading = foldersDone + partlyRead.length < foldersTotal;
  const groups = React.useMemo(() => {
    if (titles.mentionsOnly)
      return titles.groups.map((g) => ({
        ...g,
        aside: mentionsReading ? (
          <SearchProgress
            label={`${foldersDone} of ${foldersTotal} folders searched`}
          />
        ) : undefined,
      }));
    if (titles.empty || titles.tagsOnly) return titles.groups;
    const textGroup: PaletteGroupView = {
      id: 'text',
      label: 'In document text',
      // Hits for an older query would highlight words no longer typed.
      items: textQuery === query ? textHits.items : [],
      aside: reading ? (
        <SearchProgress
          label={`${foldersDone} of ${foldersTotal} folders searched`}
        />
      ) : undefined,
    };
    return [...titles.groups, textGroup];
  }, [
    titles,
    textHits,
    textQuery,
    query,
    reading,
    mentionsReading,
    foldersDone,
    foldersTotal,
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
    const target = titles.targets.get(item.id) ?? textHits.targets.get(item.id);
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
      warning={titles.warning}
      // Nothing is claimed about mentions until every folder is read.
      emptyText={
        !titles.mentionsOnly ? EMPTY_TEXT : mentionsReading ? '' : NO_MENTIONS
      }
      onOpen={onOpen}
    />
  );
}
