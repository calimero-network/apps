// The sidebar's contents: Home, Views and Tags over the folder tree, with each
// section's collapse remembered per workspace on this device.

import React from 'react';
import { useLocation } from 'react-router-dom';
import { FolderTree } from '@/components/folders/FolderTree';
import { useWorkspaceIndexValue } from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useTags } from '@/hooks/useTags';
import { parseHomeQuery, serializeHomeQuery } from '@/lib/homeQuery';
import { sidebarTags, tagCounts } from '@/lib/tags';
import { SidebarNav } from './SidebarNav';

const SECTIONS_KEY_PREFIX = 'mero-drive:sidebar:'; // + workspace id: which sections are collapsed
const ALL_OPEN = { views: false, tags: false, folders: false };
const noop = () => {};

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
  const { rows } = useWorkspaceIndexValue();
  const { tags } = useTags();
  const [stored, setStored] = useLocalStorage<Partial<Sections> | null>(
    `${SECTIONS_KEY_PREFIX}${ws}`,
    null,
  );
  const collapsed: Sections = { ...ALL_OPEN, ...stored };
  const toggle = (section: Section) =>
    setStored({ ...collapsed, [section]: !collapsed[section] });

  // A tag's page is Home filtered to that one tag and nothing else.
  const onHome = !!route && !route.folder && !route.settings;
  const q = parseHomeQuery(new URLSearchParams(search));
  const tagPage =
    onHome &&
    q.tags.length === 1 &&
    q.folders.length === 0 &&
    !q.updated &&
    !q.by &&
    !q.archived
      ? q.tags[0]
      : null;
  const counts = tagCounts(rows);
  const go = (homeSearch?: string) => {
    goHome(homeSearch);
    onNavigate();
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SidebarNav
        home={{
          count: rows.filter((r) => !r.archived).length,
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
          onSelect: () =>
            go(
              serializeHomeQuery({
                folders: [],
                tags: [t.key],
                archived: false,
                sort: 'updated',
              }),
            ),
        }))}
        onAddView={noop}
        onAddTag={noop}
        canManage={false}
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
    </div>
  );
}
