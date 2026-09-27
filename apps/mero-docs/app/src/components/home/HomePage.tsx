// The workspace's landing screen: every doc the member can read, filtered by
// the URL so a pasted link shows the same list. A folder route scopes it.

import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { QuietLoading } from '@/components/ui/empty-state';
import { UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';
import { NewFolderDialog } from '@/components/folders/NewFolderDialog';
import { useWorkspaceIndexValue } from '@/context/WorkspaceIndexContext';
import { DEV_NODE_PARAM, useAppRoute } from '@/hooks/useAppRoute';
import { useCreateDocument } from '@/hooks/useCreateDocument';
import { useDocs } from '@/hooks/useDocs';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { usePresenceByDoc, type DocPeer } from '@/hooks/usePresenceByDoc';
import { useTags } from '@/hooks/useTags';
import type { FolderIndexStatus } from '@/hooks/useWorkspaceIndex';
import { nameCollator } from '@/lib/collate';
import { folderLabel } from '@/lib/folderLabel';
import {
  applyHomeQuery,
  parseHomeQuery,
  serializeHomeQuery,
  type HomeQuery,
} from '@/lib/homeQuery';
import { updatedLabel } from '@/lib/relativeTime';
import { docUrl } from '@/lib/routes';
import { sidebarTags, TAG_NEUTRAL } from '@/lib/tags';
import {
  rowKey,
  type FolderInfo,
  type IndexRow,
} from '@/lib/workspaceIndex/types';
import { DocTable } from './DocTable';
import { FilterBar } from './FilterBar';
import { FilterChecklist } from './FilterChecklist';
import { HomeEmpty } from './HomeEmpty';
import { HomeHeader, headerActionClass } from './HomeHeader';
import { NewDocFolderPicker } from './NewDocFolderPicker';
import { UPDATED_OPTIONS, UpdatedMenu } from './UpdatedMenu';
import type { DocRowView, FilterChipView } from './types';

const CLOCK_TICK_MS = 60_000; // "2 min ago" labels and the Updated window move on
const SORT_CYCLE: HomeQuery['sort'][] = ['updated', 'name', 'created'];
const SORT_LABELS: Record<HomeQuery['sort'], string> = {
  updated: 'Last updated',
  name: 'Name',
  created: 'Created',
};
const SELF_LABEL = 'You';
const UNKNOWN_TAG_LABEL = 'Unknown tag';
const UNKNOWN_FOLDER_LABEL = 'Unknown folder';
const CREATE_FAILED = "Couldn't create a document. Try again.";

interface Props {
  folderId?: string; // the folder route: this folder and its subfolders
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

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

function isFiltered(q: HomeQuery): boolean {
  return (
    q.folders.length > 0 ||
    q.tags.length > 0 ||
    !!q.updated ||
    !!q.by ||
    q.archived
  );
}

/** A chip naming the first pick, "+N" for the rest. */
function listChipLabel(noun: string, names: string[], unknown: string) {
  if (names.length === 1 && names[0] === unknown) return unknown;
  const more = names.length > 1 ? ` +${names.length - 1}` : '';
  return `${noun}: ${names[0]}${more}`;
}

function hereLabel(here: DocPeer[]): string | undefined {
  if (here.length === 0) return undefined;
  if (here.length === 1) return `${here[0].name} is here`;
  if (here.length === 2) return `${here[0].name} and ${here[1].name} are here`;
  return `${here[0].name} and ${here.length - 1} others are here`;
}

function useNow(): number {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Each folder's names and ids from the root, and its colour, else its nearest ancestor's. */
function useFolderPaths(folders: FolderInfo[]) {
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

// Probes one folder's write access; a hook per folder, so each gets a component.
function CanCreateProbe({
  namespaceId,
  folderId,
  report,
}: {
  namespaceId: string;
  folderId: string;
  report: (folderId: string, can: boolean) => void;
}) {
  const { canEditDocs } = useFolderPermissions(namespaceId, folderId);
  React.useEffect(
    () => report(folderId, canEditDocs),
    [folderId, canEditDocs, report],
  );
  React.useEffect(() => () => report(folderId, false), [folderId, report]);
  return null;
}

// Creates an Untitled doc in `folderId` through the folder's own docs hook, once its context resolves.
function CreateDoc({
  folderId,
  onOpenDoc,
  onFailed,
}: {
  folderId: string;
  onOpenDoc: (folderId: string, docId: string) => void;
  onFailed: () => void;
}) {
  const docs = useDocs(folderId);
  const { create, error } = useCreateDocument(docs, folderId, onOpenDoc);
  const startedRef = React.useRef(false);
  React.useEffect(() => {
    if (!docs.contextId || startedRef.current) return;
    startedRef.current = true;
    void create();
  }, [docs.contextId, create]);
  React.useEffect(() => {
    if (error || docs.error) onFailed();
  }, [error, docs.error, onFailed]);
  return null;
}

export function HomePage({ folderId }: Props) {
  const {
    namespaceId,
    rootGroupId,
    selfIdentity,
    namespaceMemberNames,
    registryFolders,
    resolvedFolderIds,
  } = useDriveWorkspace();
  const { rows, folders, folderStatus, refetchFolder } =
    useWorkspaceIndexValue();
  const { tags, byKey: tagsByKey } = useTags();
  const presence = usePresenceByDoc();
  const { route, goHome, goFolder, goDoc } = useAppRoute();
  const { search } = useLocation();
  const now = useNow();
  const paths = useFolderPaths(folders);
  const nsPerms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');

  // The folder route owns the folder filter, so its URL never carries one.
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  const parsed = parseHomeQuery(params);
  const q: HomeQuery = folderId ? { ...parsed, folders: [] } : parsed;
  const canonical = serializeHomeQuery(q);
  const navigateQuery = React.useCallback(
    (next: string, replace: boolean) =>
      folderId
        ? goFolder(folderId, { search: next, replace })
        : goHome(next, { replace }),
    [folderId, goFolder, goHome],
  );
  // Compared as parsed pairs: the router may re-encode the same query.
  React.useEffect(() => {
    const current = new URLSearchParams(params);
    current.delete(DEV_NODE_PARAM);
    if (new URLSearchParams(canonical).toString() !== current.toString()) {
      navigateQuery(canonical, true);
    }
  }, [params, canonical, navigateQuery]);
  const setQuery = (next: HomeQuery) =>
    navigateQuery(
      serializeHomeQuery(folderId ? { ...next, folders: [] } : next),
      false,
    );
  const clearFilters = () =>
    setQuery({ folders: [], tags: [], archived: false, sort: q.sort });

  const scope = React.useMemo(
    () =>
      folderId
        ? folders.filter((f) => paths.get(f.id)?.ids.includes(folderId))
        : folders,
    [folderId, folders, paths],
  );
  const scopeIds = React.useMemo(
    () => new Set(scope.map((f) => f.id)),
    [scope],
  );
  const effective: HomeQuery = folderId ? { ...q, folders: [folderId] } : q;
  const shown = applyHomeQuery(rows, effective, now, folders);
  // What the chip counts are taken over: the scope and the Archived switch, no other filter.
  const base = rows.filter(
    (r) => scopeIds.has(r.folderId) && r.archived === q.archived,
  );

  // A restricted folder is withheld until its access check lands, so the first
  // answer waits for them all; a folder that arrives later must not blank the list.
  const allResolved =
    !!registryFolders &&
    registryFolders.every((f) => resolvedFolderIds.has(f.id));
  const [settledOnce, setSettledOnce] = React.useState(false);
  React.useEffect(() => {
    if (allResolved) setSettledOnce(true);
  }, [allResolved]);
  const foldersKnown = !!registryFolders && (allResolved || settledOnce);
  const statusOf = (id: string): FolderIndexStatus =>
    folderStatus[id] ?? 'loading';
  const loading =
    !foldersKnown || scope.some((f) => statusOf(f.id) === 'loading');
  const syncing = scope.filter((f) => statusOf(f.id) === 'syncing');
  const failed = scope.filter((f) => statusOf(f.id) === 'error');

  // --- New document ---
  const [creatable, setCreatable] = React.useState<Record<string, boolean>>({});
  const reportCreatable = React.useCallback(
    (id: string, can: boolean) =>
      setCreatable((prev) =>
        prev[id] === can ? prev : { ...prev, [id]: can },
      ),
    [],
  );
  // A folder route creates in that folder, not in one of its subfolders.
  const candidates = scope.filter(
    (f) => (!folderId || f.id === folderId) && statusOf(f.id) === 'ready',
  );
  const writable = candidates.filter((f) => creatable[f.id]);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [creatingIn, setCreatingIn] = React.useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const newDocument = () => {
    if (writable.length === 1) setCreatingIn(writable[0].id);
    else setPickerOpen(true);
  };
  const onCreateFailed = React.useCallback(() => {
    toast.error(CREATE_FAILED);
    setCreatingIn(null);
  }, []);

  // --- Rows ---
  const openKey = (key: string, newTab: boolean) => {
    const r = shown.find((x) => rowKey(x.folderId, x.docId) === key);
    if (!r) return;
    if (!newTab) return goDoc(r.folderId, r.docId);
    if (route)
      window.open(docUrl(route.ws, r.folderId, r.docId), '_blank', 'noopener');
  };
  const view: DocRowView[] = shown.map((r) => {
    const key = rowKey(r.folderId, r.docId);
    const here = presence.get(key) ?? [];
    const path = paths.get(r.folderId);
    return {
      key,
      title: r.title.trim(),
      folderPath: path?.names ?? [UNKNOWN_FOLDER_LABEL],
      folderColor: path?.color,
      tags: r.tags.flatMap((k) => {
        const t = tagsByKey.get(k);
        if (t?.deleted) return [];
        return [{ key: k, name: t?.name ?? k, color: t?.color ?? TAG_NEUTRAL }];
      }),
      here,
      liveLabel: hereLabel(here),
      updatedLabel: updatedLabel(r.updatedAt, now),
      archived: r.archived,
    };
  });

  // --- Chips ---
  const personName = (id: string) =>
    id === selfIdentity
      ? SELF_LABEL
      : namespaceMemberNames[id] || UNNAMED_MEMBER_LABEL;
  const tagName = (key: string) => {
    const t = tagsByKey.get(key);
    return t && !t.deleted ? t.name : UNKNOWN_TAG_LABEL;
  };
  const folderName = (id: string) =>
    paths.get(id)?.names.join(' / ') ?? UNKNOWN_FOLDER_LABEL;
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
  const nextSort =
    SORT_CYCLE[(SORT_CYCLE.indexOf(q.sort) + 1) % SORT_CYCLE.length];

  // --- Header ---
  const scopeFolder = folderId
    ? folders.find((f) => f.id === folderId)
    : undefined;
  const title = folderId ? folderLabel(scopeFolder?.name) : 'Home';
  const folderCount = new Set(shown.map((r) => r.folderId)).size;
  const subtitle = isFiltered(q)
    ? `${plural(shown.length, 'document')} ${shown.length === 1 ? 'matches' : 'match'}`
    : shown.length === 0
      ? plural(0, 'document')
      : `${plural(shown.length, 'document')} across ${plural(folderCount, 'folder')}`;

  const pickerFolders = writable.map((f) => {
    const path = paths.get(f.id);
    return {
      id: f.id,
      name: folderLabel(f.name),
      path: path?.names ?? [],
      color: path?.color,
    };
  });

  const emptyKind =
    !foldersKnown || view.length > 0
      ? null
      : folders.length === 0 && !folderId
        ? 'no-folders'
        : loading
          ? null
          : isFiltered(q)
            ? 'no-matches'
            : syncing.length === 0 && failed.length === 0
              ? 'no-docs'
              : null;
  const emptyAction = {
    'no-folders': nsPerms.canCreateFolder
      ? () => setNewFolderOpen(true)
      : undefined,
    'no-matches': clearFilters,
    'no-docs': writable.length ? newDocument : undefined,
  } as const;
  const body =
    view.length > 0 ? (
      <DocTable
        rows={view}
        onOpen={(key) => openKey(key, false)}
        onOpenInNewTab={(key) => openKey(key, true)}
      />
    ) : emptyKind ? (
      <HomeEmpty kind={emptyKind} onAction={emptyAction[emptyKind]} />
    ) : !foldersKnown || loading ? (
      <QuietLoading />
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card">
      <HomeHeader
        title={title}
        subtitle={foldersKnown ? subtitle : ''}
        actions={
          // An empty list carries New document itself, so it is offered once.
          writable.length > 0 &&
          emptyKind !== 'no-docs' && (
            <Button
              className={headerActionClass}
              disabled={!!creatingIn}
              onClick={newDocument}
            >
              <Plus />
              New document
            </Button>
          )
        }
      />
      {foldersKnown && folders.length > 0 && (
        <FilterBar
          chips={chips}
          sortLabel={SORT_LABELS[q.sort]}
          onSortClick={() => setQuery({ ...q, sort: nextSort })}
          onClear={clearFilters}
        />
      )}
      {(syncing.length > 0 || failed.length > 0) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground md:px-7"
        >
          {syncing.length > 0 && (
            <span>
              Still syncing {syncing.map((f) => folderLabel(f.name)).join(', ')}
              .
            </span>
          )}
          {failed.length > 0 && (
            <span className="flex items-center gap-2">
              Couldn't load {failed.map((f) => folderLabel(f.name)).join(', ')}.
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => failed.forEach((f) => refetchFolder(f.id))}
              >
                Try again
              </Button>
            </span>
          )}
        </div>
      )}
      {body}
      {namespaceId &&
        candidates.map((f) => (
          <CanCreateProbe
            key={f.id}
            namespaceId={namespaceId}
            folderId={f.id}
            report={reportCreatable}
          />
        ))}
      {creatingIn && (
        <CreateDoc
          key={creatingIn}
          folderId={creatingIn}
          onOpenDoc={goDoc}
          onFailed={onCreateFailed}
        />
      )}
      <NewDocFolderPicker
        open={pickerOpen}
        folders={pickerFolders}
        onPick={(id) => {
          setPickerOpen(false);
          setCreatingIn(id);
        }}
        onOpenChange={setPickerOpen}
      />
      {newFolderOpen && (
        <NewFolderDialog
          parentFolderId={null}
          onClose={() => setNewFolderOpen(false)}
        />
      )}
    </div>
  );
}
