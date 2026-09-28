// The sidebar's contents: Home, Views and Tags over the folder tree, with each
// section's collapse remembered per workspace on this device.

import React from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { FolderTree } from '@/components/folders/FolderTree';
import { defaultViewName, SORT_LABELS, summarizeHomeQuery } from '@/components/home/filterSummary';
import { useFolderPaths } from '@/components/home/useHomeChips';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { RenameTagDialog } from '@/components/tags/RenameTagDialog';
import { SaveViewPopover } from '@/components/views/SaveViewPopover';
import { useWorkspaceIndexValue } from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useNow } from '@/hooks/useNow';
import { useSavedViews, type SavedView } from '@/hooks/useSavedViews';
import { NewTagDialog } from '@/components/tags/NewTagDialog';
import { TAG_NAME_TAKEN, useCanManageTags, useTags } from '@/hooks/useTags';
import { copyLink } from '@/lib/copyLink';
import {
  isHomeQueryFiltered,
  parseHomeQuery,
  serializeHomeQuery,
  tagPageKey,
  viewRowCount,
  withView,
} from '@/lib/homeQuery';
import { namespaceLabel } from '@/lib/namespaceLabel';
import { homeUrl } from '@/lib/routes';
import {
  findTagByName,
  firstUnusedColor,
  sidebarTags,
  tagCounts,
  withoutDeletedTags,
} from '@/lib/tags';
import { SidebarNav } from './SidebarNav';

const SECTIONS_KEY_PREFIX = 'mero-drive:sidebar:'; // + workspace id: which sections are collapsed
const ALL_OPEN = { views: false, tags: false, folders: false };
const NO_FILTER_HINT = 'Turn on a filter to save it as a view.';

type Sections = typeof ALL_OPEN;
type Section = keyof Sections;

interface Props {
  ws: string;
  selectedDocId: string | null;
  onSelectFolder: (folderId: string) => void;
  onOpenDoc: (folderId: string, docId: string) => void;
  onNavigate: () => void;
}

export function WorkspaceNav({
  ws,
  selectedDocId,
  onSelectFolder,
  onOpenDoc,
  onNavigate,
}: Props) {
  const { route, goHome } = useAppRoute();
  const { search } = useLocation();
  const { rows, folders, foldersKnown, folderStatus } =
    useWorkspaceIndexValue();
  const { tags, byKey: tagsByKey, createTag } = useTags();
  const canManageTags = useCanManageTags();
  const {
    namespaces = [],
    selfIdentity = null,
    namespaceMemberNames = {},
  } = useDriveWorkspace();
  const { views: savedViews, save: saveView, rename: renameView, remove: removeView } =
    useSavedViews(ws);
  const confirm = useConfirm();
  const paths = useFolderPaths(folders);
  const [newTag, setNewTag] = React.useState<{ error?: string } | null>(null);
  const [saveViewOpen, setSaveViewOpen] = React.useState(false);
  const addViewRef = React.useRef<HTMLButtonElement>(null);
  const [savingView, setSavingView] = React.useState(false);
  const [renamingView, setRenamingView] = React.useState<SavedView | null>(
    null,
  );
  const [stored, setStored] = useLocalStorage<Partial<Sections> | null>(
    `${SECTIONS_KEY_PREFIX}${ws}`,
    null,
  );
  const collapsed: Sections = { ...ALL_OPEN, ...stored };
  const toggle = (section: Section) =>
    setStored({ ...collapsed, [section]: !collapsed[section] });

  const onHome = !!route && !route.folder && !route.settings;
  const q = parseHomeQuery(new URLSearchParams(search));
  const tagPage = onHome ? tagPageKey(q) : null;
  const liveRows = React.useMemo(
    () => withoutDeletedTags(rows, tagsByKey),
    [rows, tagsByKey],
  );
  const now = useNow();
  const counts = tagCounts(rows);
  // The Home count claims every folder was read; a failed one leaves nothing to claim from.
  const statuses = folders.map((f) => folderStatus[f.id]);
  const countKnown =
    foldersKnown &&
    !statuses.includes('loading') &&
    (rows.length > 0 || statuses.every((st) => st === 'ready'));
  const go = (homeSearch?: string) => {
    goHome(homeSearch);
    onNavigate();
  };
  const tagPageSearch = (key: string) =>
    serializeHomeQuery({
      folders: [],
      tags: [key],
      archived: false,
      sort: 'updated',
    });
  // A new tag has no docs, so the sidebar cannot list it; its page shows it was made.
  const createTagFromSidebar = async (name: string, color: string) => {
    if (findTagByName(tags, name)) {
      setNewTag({ error: TAG_NAME_TAKEN });
      return;
    }
    try {
      const key = await createTag(name, color);
      setNewTag(null);
      go(tagPageSearch(key));
    } catch {
      setNewTag({}); // reported by a toast; the dialog stays for another try
    }
  };

  // --- Views ---
  const filtered = onHome && isHomeQueryFiltered(q);
  const selectedViewId = onHome ? q.view : undefined;
  const workspaceName = namespaceLabel(
    namespaces.find((n) => n.namespaceId === ws)?.name,
  );
  const summaryArgs = {
    q,
    tagsByKey,
    paths,
    selfIdentity,
    namespaceMemberNames,
    sortLabel: SORT_LABELS[q.sort],
  };
  const onAddView = () => {
    if (!filtered) {
      toast.message(NO_FILTER_HINT);
      return;
    }
    setSaveViewOpen(true);
  };
  const saveFromSidebar = async ({
    name,
    scope,
  }: {
    name: string;
    scope: 'me' | 'everyone';
  }) => {
    setSavingView(true);
    try {
      const query = serializeHomeQuery({ ...q, view: undefined });
      const view = await saveView(name, query, scope);
      setSaveViewOpen(false);
      go(withView(query, view.id));
    } catch {
      // Reported by the saved views hook's own toast; the popover stays open to retry.
    } finally {
      setSavingView(false);
    }
  };
  const deleteViewAfterConfirm = async (view: SavedView) => {
    const ok = await confirm({
      title: 'Delete view?',
      body: (
        <>
          Delete <span className="font-medium">{view.name}</span>?{' '}
          {view.scope === 'everyone'
            ? 'It disappears from every sidebar.'
            : 'It comes off your sidebar on this device.'}
        </>
      ),
      confirmLabel: 'Delete view',
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeView(view.id);
      if (selectedViewId === view.id) go(serializeHomeQuery({ ...q, view: undefined }));
    } catch {
      // Reported by the saved views hook's own toast.
    }
  };
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SidebarNav
        home={{
          count: countKnown
            ? rows.filter((r) => !r.archived).length
            : undefined,
          selected: onHome && !tagPage && !selectedViewId,
          onSelect: () => go(),
        }}
        views={savedViews.map((v) => ({
          id: v.id,
          name: v.name,
          count: viewRowCount(liveRows, folders, now, v.query),
          shared: v.scope === 'everyone',
          selected: selectedViewId === v.id,
          onSelect: () => go(withView(v.query, v.id)),
          onRename: () => setRenamingView(v),
          onCopyLink: () => void copyLink(homeUrl(ws, withView(v.query, v.id))),
          onDelete: () => void deleteViewAfterConfirm(v),
          canManage: v.scope === 'me' ? true : canManageTags,
        }))}
        tags={sidebarTags(tags, counts).map((t) => ({
          key: t.key,
          name: t.name,
          color: t.color,
          count: counts.get(t.key) ?? 0,
          selected: tagPage === t.key && !selectedViewId,
          onSelect: () => go(tagPageSearch(t.key)),
        }))}
        onAddView={onAddView}
        addViewRef={addViewRef}
        onAddTag={() => setNewTag({})}
        canManage={canManageTags}
        collapsed={collapsed}
        onToggleSection={toggle}
      />
      <FolderTree
        selectedDocId={selectedDocId}
        onSelectFolder={onSelectFolder}
        onOpenDoc={onOpenDoc}
        collapsed={collapsed.folders}
        onToggleCollapsed={() => toggle('folders')}
      />
      <SaveViewPopover
        anchorRef={addViewRef}
        open={saveViewOpen}
        onOpenChange={setSaveViewOpen}
        defaultName={defaultViewName(summaryArgs)}
        filters={summarizeHomeQuery(summaryArgs)}
        workspaceName={workspaceName}
        canShare={canManageTags}
        saving={savingView}
        onSave={(view) => void saveFromSidebar(view)}
      />
      <NewTagDialog
        open={!!newTag}
        color={firstUnusedColor(tags)}
        error={newTag?.error}
        onSubmit={(name, color) => void createTagFromSidebar(name, color)}
        onOpenChange={(open) => !open && setNewTag(null)}
      />
      {renamingView && (
        <RenameTagDialog
          open
          title="Rename view"
          name={renamingView.name}
          onSubmit={(name) => {
            const view = renamingView;
            setRenamingView(null);
            void renameView(view.id, name).catch(() => {});
          }}
          onOpenChange={(open) => !open && setRenamingView(null)}
        />
      )}
    </div>
  );
}
