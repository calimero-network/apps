// The sidebar's contents: Home, Views and Tags over the folder tree, with each
// section's collapse remembered per workspace on this device.

import React from 'react';
import { useLocation } from 'react-router-dom';
import { FolderTree } from '@/components/folders/FolderTree';
import { useWorkspaceIndexValue } from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { NewTagDialog } from '@/components/tags/NewTagDialog';
import { TAG_NAME_TAKEN, useCanManageTags, useTags } from '@/hooks/useTags';
import {
  parseHomeQuery,
  serializeHomeQuery,
  tagPageKey,
} from '@/lib/homeQuery';
import {
  findTagByName,
  firstUnusedColor,
  sidebarTags,
  tagCounts,
} from '@/lib/tags';
import { SidebarNav } from './SidebarNav';

const SECTIONS_KEY_PREFIX = 'mero-drive:sidebar:'; // + workspace id: which sections are collapsed
const ALL_OPEN = { views: false, tags: false, folders: false };

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
  const { tags, createTag } = useTags();
  const canManageTags = useCanManageTags();
  const [newTag, setNewTag] = React.useState<{ error?: string } | null>(null);
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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SidebarNav
        home={{
          count: countKnown
            ? rows.filter((r) => !r.archived).length
            : undefined,
          selected: onHome && !tagPage,
          onSelect: () => go(),
        }}
        views={[]}
        tags={sidebarTags(tags, counts).map((t) => ({
          key: t.key,
          name: t.name,
          color: t.color,
          count: counts.get(t.key) ?? 0,
          selected: tagPage === t.key,
          onSelect: () => go(tagPageSearch(t.key)),
        }))}
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
      <NewTagDialog
        open={!!newTag}
        color={firstUnusedColor(tags)}
        error={newTag?.error}
        onSubmit={(name, color) => void createTagFromSidebar(name, color)}
        onOpenChange={(open) => !open && setNewTag(null)}
      />
    </div>
  );
}
