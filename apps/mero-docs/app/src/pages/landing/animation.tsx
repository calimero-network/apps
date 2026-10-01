/**
 * Mero Docs - the hero animation: the real Home screen, fed a fixture and scaled into the stage.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * The top bar and folder rows copy WorkspaceLayout and FolderTreeItem, which need a live workspace.
 */

import {
  ChevronRight,
  ChevronsUpDown,
  Circle,
  Lock,
  LogOut,
  Moon,
  PanelLeft,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LogoWithText } from '@/components/icons/Logo';
import { TopBarSearch } from '@/components/search/TopBarSearch';
import { WorkspaceSidebar } from '@/components/workspace/WorkspaceSidebar';
import {
  SidebarNav,
  SidebarSectionHeader,
} from '@/components/workspace/SidebarNav';
import { HomeHeader, headerActionClass } from '@/components/home/HomeHeader';
import { FilterBar } from '@/components/home/FilterBar';
import { DocTable } from '@/components/home/DocTable';
import type { DocRowView, FilterChipView } from '@/components/home/types';
import { COLOR_PRESETS } from '@/constants/config';
import { TAG_COLORS, TAG_COLOR_NAMES } from '@/lib/tags';

const APP_W = 1120; // the width the app lays out at before it is scaled down
const SCALE = 495 / APP_W; // the stage's design width, see STAGE_DESIGN_W
const CAPTION_H = 22; // the strip under the app that holds the caption
const APP_FONT = "'Inter Variable', 'Inter', system-ui, sans-serif"; // the landing page sets its own

const noop = () => {};
const tagHex = (name: (typeof TAG_COLOR_NAMES)[number]) =>
  TAG_COLORS[TAG_COLOR_NAMES.indexOf(name)];
const folderHex = (label: string) =>
  COLOR_PRESETS.find((c) => c.label === label)?.value;

const TAGS = [
  { key: 'roadmap', name: 'roadmap', color: tagHex('Blue'), count: 3 },
  { key: 'design', name: 'design', color: tagHex('Purple'), count: 2 },
  { key: 'q3', name: 'q3', color: tagHex('Slate'), count: 2 },
];
const FOLDERS = [
  { name: 'Product', color: folderHex('Blue') },
  { name: 'Design', color: folderHex('Purple'), lock: true },
  { name: 'Engineering', color: folderHex('Green'), lock: true },
];
const CHIPS: FilterChipView[] = [
  { id: 'folder', icon: 'folder', label: 'Folder', active: false },
  { id: 'tag', icon: 'tag', label: 'Tag', active: false },
  { id: 'updated', icon: 'calendar', label: 'Updated', active: false },
  { id: 'by', icon: 'user', label: 'Created by', active: false },
  { id: 'archived', icon: 'archive', label: 'Archived', active: false },
];

const row = (
  title: string,
  folderPath: string[],
  tags: string[],
  updatedLabel: string,
  extra: Partial<DocRowView> = {},
): DocRowView => ({
  key: title,
  title,
  folderPath,
  folderColor: FOLDERS.find((f) => f.name === folderPath[0])?.color,
  tags: tags.map((t) => TAGS.find((x) => x.key === t)!),
  here: [],
  updatedLabel,
  ...extra,
});
const DOCS = [
  row('Q3 roadmap', ['Product'], ['roadmap', 'q3'], '2 min ago', {
    liveLabel: 'Bob is here',
    here: [{ id: 'bob', name: 'Bob', colour: folderHex('Amber')! }],
  }),
  row('API spec v2', ['Engineering', 'Specs'], ['design'], '18 min ago'),
  row('Brand guidelines', ['Design'], ['design'], '1 h ago'),
  row('Launch plan', ['Product'], ['roadmap'], 'Yesterday'),
  row('Pricing notes', ['Product'], ['q3', 'roadmap'], 'Sep 20'),
  row('Incident runbook', ['Engineering'], [], 'Sep 17'),
  row('Hiring loop', ['Design'], [], 'Sep 12'),
];

function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4">
      <div className="flex min-w-0 items-center gap-4">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
          <PanelLeft className="h-4 w-4" />
        </Button>
        <LogoWithText size={22} textClassName="whitespace-nowrap" />
        <div className="h-6 w-px bg-border" />
        <Button variant="ghost" size="sm" className="min-w-0 gap-1.5 px-2">
          Product team
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </div>
      <div className="flex min-w-0 flex-1 justify-center px-6">
        <TopBarSearch onOpen={noop} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <Circle className="h-2 w-2 fill-sync-synced text-sync-synced" />
          localhost:2428
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Moon className="[[data-cal-lp-theme=dark]_&]:hidden" />
          <Sun className="hidden [[data-cal-lp-theme=dark]_&]:block" />
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Settings className="h-3.5 w-3.5" />
          Settings
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <LogOut className="h-3.5 w-3.5" />
          Log out
        </Button>
      </div>
    </header>
  );
}

function Folders() {
  return (
    <>
      <SidebarSectionHeader
        title="Folders"
        collapsed={false}
        onToggle={noop}
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
      <ul className="space-y-px px-2 pb-2">
        {FOLDERS.map((f) => (
          <li
            key={f.name}
            className="flex h-[30px] items-center gap-1.5 rounded-md px-1.5 text-sm text-foreground"
          >
            <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
            <span
              className="h-2.5 w-2.5 rounded-sm border border-border/50"
              style={{ backgroundColor: f.color }}
            />
            <span className="flex-1 truncate">{f.name}</span>
            {f.lock && <Lock className="h-3 w-3 text-muted-foreground" />}
          </li>
        ))}
      </ul>
    </>
  );
}

export default function DriveAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true" inert>
      <div
        className="absolute flex origin-top-left flex-col overflow-hidden border-b bg-background text-foreground"
        style={{
          left: 0,
          top: 0,
          width: APP_W,
          height: `calc((100% - ${CAPTION_H}px) / ${SCALE})`,
          transform: `scale(${SCALE})`,
          ['--cal-lp-font' as string]: APP_FONT,
        }}
      >
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <WorkspaceSidebar width={240} onWidthChange={noop}>
            <SidebarNav
              home={{ count: 12, selected: true, onSelect: noop }}
              mentions={{ count: 2, selected: false, onSelect: noop }}
              views={[
                {
                  id: 'design',
                  name: 'Design this week',
                  count: 2,
                  shared: false,
                  selected: false,
                  onSelect: noop,
                  onRename: noop,
                  onCopyLink: noop,
                  onDelete: noop,
                  canManage: false,
                },
              ]}
              tags={TAGS.map((t) => ({
                ...t,
                selected: false,
                onSelect: noop,
              }))}
              onAddView={noop}
              onAddTag={noop}
              canManage
              collapsed={{ views: false, tags: false }}
              onToggleSection={noop}
            />
            <Folders />
          </WorkspaceSidebar>
          <main className="flex min-w-0 flex-1 flex-col bg-card">
            <HomeHeader
              title="Home"
              subtitle="12 documents across 4 folders"
              actions={
                <Button className={headerActionClass}>
                  <Plus />
                  New document
                </Button>
              }
            />
            <FilterBar
              chips={CHIPS}
              sortLabel="Last updated"
              onSortClick={noop}
              onClear={noop}
            />
            {/* The newest row fades in: a peer's new doc arriving live. */}
            <div className="[&_li:first-child]:[animation:cal-lp-a-in_6s_ease-in-out_infinite]">
              <DocTable rows={DOCS} onOpen={noop} />
            </div>
          </main>
        </div>
      </div>

      <span
        className="cal-lp-a-txt cal-lp-a-txt--dim"
        style={{ left: 20, bottom: 3, fontSize: 8.5 }}
      >
        Home lists every document you can open, in every folder. A lock means a
        folder replicates only to its members.
      </span>
    </div>
  );
}
