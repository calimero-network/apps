// The workspace's landing screen: every doc the member can read, filtered by
// the URL so a pasted link shows the same list. A folder route scopes it.

import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { Bookmark, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { hereLabel } from '@/components/common/LivePill';
import { QuietLoading } from '@/components/ui/empty-state';
import { NewFolderDialog } from '@/components/folders/NewFolderDialog';
import { RenameTagDialog } from '@/components/tags/RenameTagDialog';
import { TagPageHeader } from '@/components/tags/TagPageHeader';
import { SaveViewPopover } from '@/components/views/SaveViewPopover';
import { useWorkspaceIndexValue } from '@/context/WorkspaceIndexContext';
import { DEV_NODE_PARAM, useAppRoute } from '@/hooks/useAppRoute';
import { useCreateDocument } from '@/hooks/useCreateDocument';
import { useDocs } from '@/hooks/useDocs';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { useNow } from '@/hooks/useNow';
import { usePresenceByDoc } from '@/hooks/usePresenceByDoc';
import { useSavedViews } from '@/hooks/useSavedViews';
import { TagNameTakenError, useCanManageTags, useTags } from '@/hooks/useTags';
import type { FolderIndexStatus } from '@/hooks/useWorkspaceIndex';
import { folderLabel } from '@/lib/folderLabel';
import {
  applyHomeQuery,
  isHomeQueryFiltered,
  parseHomeQuery,
  serializeHomeQuery,
  tagPageKey,
  withView,
  type HomeQuery,
} from '@/lib/homeQuery';
import { namespaceLabel } from '@/lib/namespaceLabel';
import { updatedLabel } from '@/lib/relativeTime';
import { docUrl } from '@/lib/routes';
import { TAG_NEUTRAL, withoutDeletedTags } from '@/lib/tags';
import { rowKey } from '@/lib/workspaceIndex/types';
import { DocTable } from './DocTable';
import { defaultViewName, SORT_LABELS, summarizeHomeQuery } from './filterSummary';
import { FilterBar } from './FilterBar';
import { HomeEmpty } from './HomeEmpty';
import { HomeHeader, headerActionClass } from './HomeHeader';
import { NewDocFolderPicker } from './NewDocFolderPicker';
import type { DocRowView } from './types';
import {
  UNKNOWN_FOLDER_LABEL,
  useFolderPaths,
  useHomeChips,
} from './useHomeChips';

const SORT_CYCLE: HomeQuery['sort'][] = ['updated', 'name', 'created'];
const CREATE_FAILED = "Couldn't create a document. Try again.";
const NO_FOLDERS_READ_ONLY =
  'Documents live in folders. A workspace owner needs to create one or share one with you.';
const EMPTY_FOLDER = 'No documents in this folder yet.';
const EMPTY_FOLDER_READ_ONLY = `${EMPTY_FOLDER} They show up here when someone adds one.`;

interface Props {
  folderId?: string; // the folder route: this folder and its subfolders
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// Probes one folder's write access; a hook per folder, so each gets a component.
function CanCreateProbe({
  namespaceId,
  folderId,
  report,
}: {
  namespaceId: string;
  folderId: string;
  report: (folderId: string, can: boolean | undefined) => void;
}) {
  const perms = useFolderPermissions(namespaceId, folderId);
  // A failed read is not a role: it stays unknown rather than reading as "viewer".
  const unknown =
    perms.loading || perms.roleLoading || !!perms.error || !!perms.roleError;
  const can = unknown ? undefined : perms.canEditDocs;
  React.useEffect(() => report(folderId, can), [folderId, can, report]);
  React.useEffect(() => () => report(folderId, undefined), [folderId, report]);
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
  const { namespaceId, rootGroupId, namespaces, selfIdentity, namespaceMemberNames } =
    useDriveWorkspace();
  const { rows, folders, foldersKnown, folderStatus, refetchFolder } =
    useWorkspaceIndexValue();
  const { byKey: tagsByKey, renameTag, recolorTag, deleteTag } = useTags();
  const canShare = useCanManageTags();
  const { save: saveView } = useSavedViews(namespaceId ?? '');
  const confirm = useConfirm();
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
  const liveRows = React.useMemo(
    () => withoutDeletedTags(rows, tagsByKey),
    [rows, tagsByKey],
  );
  const effective: HomeQuery = folderId ? { ...q, folders: [folderId] } : q;
  const shown = applyHomeQuery(liveRows, effective, now, folders);
  // What the chip counts are taken over: the scope and the Archived switch, no other filter.
  const base = liveRows.filter(
    (r) => scopeIds.has(r.folderId) && r.archived === q.archived,
  );

  const statusOf = (id: string): FolderIndexStatus =>
    folderStatus[id] ?? 'loading';
  const loading =
    !foldersKnown || scope.some((f) => statusOf(f.id) === 'loading');
  const syncing = scope.filter((f) => statusOf(f.id) === 'syncing');
  const failed = scope.filter((f) => statusOf(f.id) === 'error');

  // --- New document ---
  // Undefined while a folder's write access is still being checked.
  const [creatable, setCreatable] = React.useState<
    Record<string, boolean | undefined>
  >({});
  const reportCreatable = React.useCallback(
    (id: string, can: boolean | undefined) =>
      setCreatable((prev) =>
        prev[id] === can ? prev : { ...prev, [id]: can },
      ),
    [],
  );
  // A folder route creates in that folder, not in one of its subfolders.
  const candidates = scope.filter(
    (f) => (!folderId || f.id === folderId) && statusOf(f.id) === 'ready',
  );
  const writable = candidates.filter((f) => creatable[f.id] === true);
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
      tags: r.tags.map((k) => {
        const t = tagsByKey.get(k);
        return { key: k, name: t?.name ?? k, color: t?.color ?? TAG_NEUTRAL };
      }),
      here,
      liveLabel: hereLabel(here),
      updatedLabel: updatedLabel(r.updatedAt, now),
      archived: r.archived,
    };
  });

  const chips = useHomeChips({ q, folderId, setQuery, folders, paths, base });

  const nextSort =
    SORT_CYCLE[(SORT_CYCLE.indexOf(q.sort) + 1) % SORT_CYCLE.length];

  // --- Header ---
  const scopeFolder = folderId
    ? folders.find((f) => f.id === folderId)
    : undefined;
  const title = folderId ? folderLabel(scopeFolder?.name) : 'Home';
  const folderCount = new Set(shown.map((r) => r.folderId)).size;
  const subtitle = isHomeQueryFiltered(q)
    ? `${plural(shown.length, 'document')} ${shown.length === 1 ? 'matches' : 'match'}`
    : shown.length === 0
      ? plural(0, 'document')
      : `${plural(shown.length, 'document')} across ${plural(folderCount, 'folder')}`;

  // --- Save view ---
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const workspaceName = namespaceLabel(
    namespaces.find((n) => n.namespaceId === namespaceId)?.name,
  );
  const summaryArgs = {
    q: effective,
    tagsByKey,
    paths,
    selfIdentity,
    namespaceMemberNames,
    sortLabel: SORT_LABELS[q.sort],
  };
  const saveCurrentView = async ({
    name,
    scope,
  }: {
    name: string;
    scope: 'me' | 'everyone';
  }) => {
    setSaving(true);
    try {
      // A folder route's folder is part of the view, which opens on Home.
      const queryForSave = serializeHomeQuery({ ...effective, view: undefined });
      const savedView = await saveView(name, queryForSave, scope);
      setSaveOpen(false);
      goHome(withView(queryForSave, savedView.id), { replace: true });
    } catch {
      // Reported by the saved views hook's own toast; the popover stays open to retry.
    } finally {
      setSaving(false);
    }
  };

  // --- Tag page ---
  const pageKey = folderId ? null : tagPageKey(q);
  const pageTag = pageKey ? tagsByKey.get(pageKey) : undefined;
  const tagPage = pageTag && !pageTag.deleted ? pageTag : undefined;
  const [renaming, setRenaming] = React.useState<{ error?: string } | null>(
    null,
  );
  React.useEffect(() => setRenaming(null), [pageKey]);
  const [deleting, setDeleting] = React.useState(false);
  const deletingRef = React.useRef(false);
  // Any other failure has been reported by a toast, so only a taken name stays under the field.
  const renameTagTo = async (key: string, name: string) => {
    try {
      await renameTag(key, name);
      setRenaming(null);
    } catch (e: unknown) {
      setRenaming({
        error: e instanceof TagNameTakenError ? e.message : undefined,
      });
    }
  };
  // One run at a time; a failure has been reported by a toast and frees the header again.
  const deleteTagAfterConfirm = async (key: string, name: string) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      const ok = await confirm({
        title: 'Delete tag?',
        body: (
          <>
            Delete <span className="font-medium">{name}</span>? It comes off
            every document you can edit and disappears everywhere else.
          </>
        ),
        confirmLabel: 'Delete tag',
        destructive: true,
      });
      if (!ok) return;
      setDeleting(true);
      const editable = new Set(
        Object.keys(creatable).filter((id) => creatable[id]),
      );
      await deleteTag(key, editable);
      goHome(undefined, { replace: true });
    } catch {
      // Reported by the tags hook.
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const pickerFolders = writable.map((f) => {
    const path = paths.get(f.id);
    return {
      id: f.id,
      name: folderLabel(f.name),
      path: path?.names ?? [],
      color: path?.color,
    };
  });

  // A number is a claim about every folder in scope, so none is made until they are all read.
  const countKnown =
    !loading &&
    (view.length > 0 || (syncing.length === 0 && failed.length === 0));
  const emptyKind =
    !foldersKnown || view.length > 0
      ? null
      : folders.length === 0 && !folderId
        ? 'no-folders'
        : loading
          ? null
          : tagPage && syncing.length === 0 && failed.length === 0
            ? 'no-tagged'
            : isHomeQueryFiltered(q)
              ? 'no-matches'
              : syncing.length === 0 && failed.length === 0
                ? 'no-docs'
                : null;
  const folderCanWrite = folderId ? creatable[folderId] : undefined;
  const emptyBody = {
    'no-folders':
      nsPerms.loading || nsPerms.error
        ? null
        : nsPerms.canCreateFolder
          ? undefined
          : NO_FOLDERS_READ_ONLY,
    'no-matches': undefined,
    'no-tagged': undefined,
    'no-docs': !folderId
      ? undefined
      : folderCanWrite === undefined
        ? null
        : folderCanWrite
          ? EMPTY_FOLDER
          : EMPTY_FOLDER_READ_ONLY,
  } as const;
  const emptyAction = {
    'no-folders': nsPerms.canCreateFolder
      ? () => setNewFolderOpen(true)
      : undefined,
    'no-matches': clearFilters,
    'no-tagged': undefined,
    'no-docs': writable.length ? newDocument : undefined,
  } as const;
  const saveViewButton = isHomeQueryFiltered(q) && (
    <SaveViewPopover
      key="save-view"
      trigger={
        <Button variant="outline" className={headerActionClass}>
          <Bookmark />
          Save view
        </Button>
      }
      defaultName={defaultViewName(summaryArgs)}
      filters={summarizeHomeQuery(summaryArgs)}
      workspaceName={workspaceName}
      canShare={canShare}
      saving={saving}
      onSave={(v) => void saveCurrentView(v)}
      open={saveOpen}
      onOpenChange={setSaveOpen}
    />
  );
  // An empty list carries New document itself, so it is offered once.
  const newDocumentButton = writable.length > 0 && emptyKind !== 'no-docs' && (
    <Button
      key="new-document"
      className={headerActionClass}
      disabled={!!creatingIn}
      onClick={newDocument}
    >
      <Plus />
      New document
    </Button>
  );
  const headerActions = saveViewButton || newDocumentButton ? (
    <>
      {saveViewButton}
      {newDocumentButton}
    </>
  ) : undefined;
  const body =
    view.length > 0 ? (
      <DocTable
        rows={view}
        onOpen={(key) => openKey(key, false)}
        onOpenInNewTab={(key) => openKey(key, true)}
      />
    ) : emptyKind ? (
      <HomeEmpty
        kind={emptyKind}
        body={emptyBody[emptyKind]}
        onAction={emptyAction[emptyKind]}
      />
    ) : !foldersKnown || loading ? (
      <QuietLoading />
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card">
      {tagPage ? (
        <TagPageHeader
          name={tagPage.name}
          color={tagPage.color}
          subtitle={
            deleting
              ? 'Deleting tag…'
              : !countKnown
                ? ''
                : shown.length === 0
                  ? 'No documents yet'
                  : `${plural(shown.length, 'document')} in ${plural(folderCount, 'folder')}`
          }
          // The workspace caps an Editor has and a Guest lacks, as useCanManageTags reads them.
          canManage={nsPerms.canCreateFolder}
          busy={deleting}
          onRename={() => setRenaming({})}
          onRecolor={(color) =>
            void recolorTag(tagPage.key, color).catch(() => {})
          }
          onDelete={() => void deleteTagAfterConfirm(tagPage.key, tagPage.name)}
          actions={saveViewButton || undefined}
        />
      ) : (
        <HomeHeader
          title={title}
          subtitle={countKnown ? subtitle : ''}
          actions={headerActions}
        />
      )}
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
      {tagPage && (
        <RenameTagDialog
          open={!!renaming}
          name={tagPage.name}
          error={renaming?.error}
          onSubmit={(name) => void renameTagTo(tagPage.key, name)}
          onOpenChange={(open) => !open && setRenaming(null)}
        />
      )}
      {newFolderOpen && (
        <NewFolderDialog
          parentFolderId={null}
          onClose={() => setNewFolderOpen(false)}
        />
      )}
    </div>
  );
}
