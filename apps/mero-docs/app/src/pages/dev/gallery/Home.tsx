import * as React from 'react';
import { Bookmark, ChevronRight, Lock, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { HomeHeader, headerActionClass } from '@/components/home/HomeHeader';
import { DocTable } from '@/components/home/DocTable';
import { FilterBar } from '@/components/home/FilterBar';
import { FilterChecklist } from '@/components/home/FilterChecklist';
import { UpdatedMenu } from '@/components/home/UpdatedMenu';
import { HomeEmpty } from '@/components/home/HomeEmpty';
import { NewDocFolderPicker } from '@/components/home/NewDocFolderPicker';
import type { DocRowView, FilterChipView } from '@/components/home/types';
import {
  SidebarNav,
  SidebarSectionHeader,
} from '@/components/workspace/SidebarNav';
import { TagPageHeader } from '@/components/tags/TagPageHeader';
import { RenameTagDialog } from '@/components/tags/RenameTagDialog';
import { SaveViewPopover } from '@/components/views/SaveViewPopover';
import { DOCS, FOLDERS, TAGS, WORKSPACE_NAME } from './mockData';

export const title = 'Home';
export const order = 10;

const PEOPLE: Record<string, string> = { BO: 'Bob', AL: 'Alice' }; // mock initials back to display names
const RESTRICTED = new Set(['Engineering', 'Finance']); // folders drawn with a lock, as the mockup
const noop = () => {};

const folderColor = (name: string) =>
  FOLDERS.find((f) => f.name === name)?.color ?? undefined;
const tagColor = (name: string) => TAGS.find((t) => t.name === name)?.color;
const tagCount = (name: string) =>
  DOCS.filter((d) => d.tags.includes(name)).length;

const ROWS: DocRowView[] = DOCS.map((d, i) => ({
  key: `f${i}/d${i}`,
  title: d.title,
  folderPath: d.folders,
  folderColor: folderColor(d.folders[0]),
  tags: d.tags.map((t) => ({ key: t, name: t, color: tagColor(t) })),
  here: (d.whoIsHere ?? []).map((p) => ({
    id: p.initials,
    name: PEOPLE[p.initials],
    colour: p.color,
  })),
  liveLabel: d.live ? 'Bob is here' : undefined,
  updatedLabel: d.updatedLabel,
}));
const DESIGN_ROWS = ROWS.filter((r) => r.tags.some((t) => t.key === 'design'));
const EDGE_ROWS: DocRowView[] = [
  {
    ...ROWS[0],
    key: 'e1',
    title:
      'A very long document title that has to truncate before it pushes the folder column aside',
    here: ['Ann Lee', 'Bob Stone', 'Cy Dunn', 'Di Ma'].map((name, i) => ({
      id: name,
      name,
      colour: TAGS[i].color,
    })),
    tags: TAGS.slice(0, 5).map((t) => ({
      key: t.name,
      name: t.name,
      color: t.color,
    })),
  },
  { ...ROWS[1], key: 'e2', title: '', liveLabel: undefined, here: [] },
  { ...ROWS[2], key: 'e3', archived: true },
];
const SORTED_TAGS = [...TAGS].sort(
  (a, b) => tagCount(b.name) - tagCount(a.name),
);

function tagChecklist(selected: string[]) {
  return (
    <FilterChecklist
      placeholder="Filter tags"
      items={SORTED_TAGS.map((t) => ({
        id: t.name,
        label: t.name,
        dotColor: t.color,
        count: tagCount(t.name),
        checked: selected.includes(t.name),
      }))}
      onToggle={noop}
      onClear={noop}
      footerHint="Match any selected tag"
    />
  );
}

function chips({
  tag,
  updated,
  tagOpen,
}: {
  tag?: string;
  updated?: boolean;
  tagOpen?: boolean;
}): FilterChipView[] {
  return [
    {
      id: 'folder',
      icon: 'folder',
      label: 'Folder',
      active: false,
      popover: (
        <FilterChecklist
          placeholder="Filter folders"
          items={FOLDERS.map((f) => ({
            id: f.name,
            label: f.name,
            count: DOCS.filter((d) => d.folders.includes(f.name)).length,
            checked: false,
          }))}
          onToggle={noop}
          onClear={noop}
          footerHint="Includes subfolders"
        />
      ),
    },
    {
      id: 'tag',
      icon: 'tag',
      label: tag ? `Tag: ${tag}` : 'Tag',
      active: !!tag,
      onClear: noop,
      popover: tagChecklist(tag ? [tag] : []),
      ...(tagOpen ? { open: true, onOpenChange: noop } : {}),
    },
    {
      id: 'updated',
      icon: 'calendar',
      label: updated ? 'Updated: Last 7 days' : 'Updated',
      active: !!updated,
      onClear: noop,
      popover: (
        <UpdatedMenu value={updated ? '7d' : undefined} onChange={noop} />
      ),
    },
    {
      id: 'by',
      icon: 'user',
      label: 'Created by',
      active: false,
      popover: (
        <FilterChecklist
          placeholder="Filter people"
          items={['You', 'Alice', 'Bob', 'Kim'].map((n) => ({
            id: n,
            label: n,
            count: DOCS.filter((d) => d.updatedBy === n).length,
            checked: false,
          }))}
          onToggle={noop}
          onClear={noop}
          footerHint="Match any selected person"
        />
      ),
    },
    {
      id: 'archived',
      icon: 'archive',
      label: 'Archived',
      active: false,
      toggle: true,
      onToggle: noop,
    },
  ];
}

function Sidebar({
  selected,
  className = 'hidden w-64 md:block',
}: {
  selected: string;
  className?: string;
}) {
  const [collapsed, setCollapsed] = React.useState({
    views: false,
    tags: false,
    folders: false,
  });
  const toggle = (section: keyof typeof collapsed) =>
    setCollapsed((c) => ({ ...c, [section]: !c[section] }));
  return (
    <aside
      className={`shrink-0 overflow-hidden border-r border-border bg-muted/20 ${className}`}
    >
      <SidebarNav
        home={{
          count: DOCS.length,
          selected: selected === 'home',
          onSelect: noop,
        }}
        views={[
          {
            id: 'v1',
            name: 'Design this week',
            count: 3,
            shared: false,
            selected: false,
            onSelect: noop,
            onRename: noop,
            onCopyLink: noop,
            onDelete: noop,
          },
          {
            id: 'v2',
            name: 'Q3 launch',
            count: 2,
            shared: true,
            selected: false,
            onSelect: noop,
            onRename: noop,
            onCopyLink: noop,
            onDelete: noop,
          },
        ]}
        tags={SORTED_TAGS.map((t) => ({
          key: t.name,
          name: t.name,
          color: t.color,
          count: tagCount(t.name),
          selected: selected === t.name,
          onSelect: noop,
        }))}
        onAddView={noop}
        onAddTag={noop}
        canManage
        collapsed={collapsed}
        onToggleSection={toggle}
      />
      {/* Static copy of FolderTree's header and rows, so the sections can be checked for alignment. */}
      <SidebarSectionHeader
        title="Folders"
        collapsed={collapsed.folders}
        onToggle={() => toggle('folders')}
        action={
          <Button
            variant="ghost"
            className="h-6 gap-1 rounded-md px-1.5 text-xs [&_svg]:size-[13px]"
          >
            <Plus />
            New
          </Button>
        }
      />
      {!collapsed.folders && (
        <ul className="space-y-px px-2">
          {FOLDERS.filter((f) => !f.parent).map((f) => (
            <li
              key={f.name}
              className="flex h-[30px] items-center gap-1.5 rounded-md px-1.5 text-sm text-foreground hover:bg-muted/60"
            >
              <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
              <span
                className="h-2.5 w-2.5 rounded-sm border border-border/50"
                style={{ backgroundColor: f.color ?? undefined }}
              />
              <span className="flex-1 truncate">{f.name}</span>
              {RESTRICTED.has(f.name) && (
                <Lock className="h-3 w-3 text-muted-foreground" />
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Frame({
  state,
  children,
}: {
  state: State;
  children: React.ReactNode;
}) {
  return (
    <div
      data-frame={state}
      className="flex h-[748px] overflow-hidden rounded-xl border bg-background xl:ml-[calc(50%_-_640px)] xl:w-[1280px]"
    >
      <Sidebar selected={state === 'Tag page' ? 'design' : 'home'} />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-card">
        {children}
      </main>
    </div>
  );
}

const newDocButton = (
  <Button className={headerActionClass}>
    <Plus />
    New document
  </Button>
);

const saveViewButton = (
  <Button variant="outline" className={`${headerActionClass} bg-card`}>
    <Bookmark />
    Save view
  </Button>
);

// One composition at a time: an open popover is portalled and pinned to the viewport, so two would overlap.
const STATES = [
  'Home',
  'Filtered, Save view open',
  'Tag filter open',
  'Tag page',
] as const;
type State = (typeof STATES)[number];

const COMPOSITIONS: Record<State, (onRename: () => void) => React.ReactNode> = {
  Home: () => (
    <>
      <HomeHeader
        title="Home"
        subtitle="10 documents across 5 folders"
        actions={newDocButton}
      />
      <FilterBar
        chips={chips({})}
        sortLabel="Last updated"
        onSortClick={noop}
        onClear={noop}
      />
      <DocTable rows={ROWS} onOpen={noop} onOpenInNewTab={noop} />
    </>
  ),
  'Filtered, Save view open': () => (
    <>
      <HomeHeader
        title="Home"
        subtitle="3 documents match"
        actions={
          <>
            <SaveViewPopover
              open
              onOpenChange={noop}
              trigger={saveViewButton}
              defaultName="Design this week"
              filters={[
                { icon: 'tag', label: 'design', color: tagColor('design') },
                { icon: 'calendar', label: 'Last 7 days' },
                { icon: 'sort', label: 'Last updated' },
              ]}
              workspaceName={WORKSPACE_NAME}
              canShare
              saving={false}
              onSave={noop}
            />
            {newDocButton}
          </>
        }
      />
      <FilterBar
        chips={chips({ tag: 'design', updated: true })}
        sortLabel="Last updated"
        onSortClick={noop}
        onClear={noop}
      />
      <DocTable rows={DESIGN_ROWS} onOpen={noop} />
    </>
  ),
  'Tag filter open': () => (
    <>
      <HomeHeader
        title="Home"
        subtitle="3 documents match"
        actions={newDocButton}
      />
      <FilterBar
        chips={chips({ tag: 'design', tagOpen: true })}
        sortLabel="Last updated"
        onSortClick={noop}
        onClear={noop}
      />
      <DocTable rows={DESIGN_ROWS} onOpen={noop} />
    </>
  ),
  'Tag page': (onRename) => (
    <>
      <TagPageHeader
        name="design"
        color={tagColor('design')}
        subtitle="3 documents in 3 folders"
        canManage
        onRename={onRename}
        onRecolor={noop}
        onDelete={noop}
      />
      <FilterBar
        chips={chips({ tag: 'design' })}
        sortLabel="Last updated"
        onSortClick={noop}
        onClear={noop}
      />
      <DocTable rows={DESIGN_ROWS} onOpen={noop} />
    </>
  ),
};

export function Gallery(): React.JSX.Element {
  const [state, setState] = React.useState<State>('Home');
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <div
          role="group"
          aria-label="Home state"
          className="flex flex-wrap gap-1.5"
        >
          {STATES.map((st) => (
            <Button
              key={st}
              size="sm"
              variant={st === state ? 'selected' : 'outline'}
              aria-pressed={st === state}
              onClick={() => setState(st)}
              className="h-7 px-2.5 text-xs"
            >
              {st}
            </Button>
          ))}
        </div>
        <Frame state={state}>
          {COMPOSITIONS[state](() => setRenameOpen(true))}
        </Frame>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Sidebar at the phone drawer's width
        </h3>
        <div data-frame="Drawer" className="w-fit rounded-xl border pb-2">
          <Sidebar
            selected="design"
            className="block w-[min(20rem,85vw)] border-r-0"
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Edge rows: long title, untitled, archived, overflowing tags and people
        </h3>
        <div
          data-frame="Edge rows"
          className="rounded-xl border bg-card xl:ml-[calc(50%_-_512px)] xl:w-[1024px]"
        >
          <DocTable rows={EDGE_ROWS} onOpen={noop} />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Empty states
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-72 rounded-xl border bg-card">
            <HomeEmpty kind="no-folders" onAction={noop} />
          </div>
          <div className="h-72 rounded-xl border bg-card">
            <HomeEmpty kind="no-docs" onAction={() => setPickerOpen(true)} />
          </div>
          <div className="h-72 rounded-xl border bg-card">
            <HomeEmpty kind="no-matches" onAction={noop} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Popover contents and dialogs
        </h3>
        <div className="flex flex-wrap items-start gap-4">
          <div className="overflow-hidden rounded-[10px] border bg-popover shadow-md">
            <UpdatedMenu value="7d" onChange={noop} />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRenameOpen(true)}
          >
            Rename tag dialog
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
          >
            Folder picker
          </Button>
        </div>
      </div>

      <RenameTagDialog
        open={renameOpen}
        name="design"
        error="A tag with this name already exists"
        onSubmit={() => setRenameOpen(false)}
        onOpenChange={setRenameOpen}
      />
      <NewDocFolderPicker
        open={pickerOpen}
        folders={[...FOLDERS, { name: 'Legal', color: '#64748b' }].map((f) => ({
          id: f.name,
          name: f.name,
          path: f.parent ? [f.parent, f.name] : [f.name],
          color: f.color ?? undefined,
        }))}
        onPick={() => setPickerOpen(false)}
        onOpenChange={setPickerOpen}
      />
    </div>
  );
}
