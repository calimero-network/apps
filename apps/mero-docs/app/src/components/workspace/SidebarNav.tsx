import * as React from 'react';
import {
  AtSign,
  Bookmark,
  ChevronDown,
  Ellipsis,
  House,
  Link,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { TagDot } from '@/components/tags/TagChip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const TOP_TAGS = 5; // tags listed before "Show all N tags"

type SectionKey = 'views' | 'tags';

interface ViewItem {
  id: string;
  name: string;
  count: number;
  shared: boolean;
  selected: boolean;
  onSelect: () => void;
  onRename?: () => void;
  onCopyLink?: () => void;
  onDelete?: () => void;
  canManage?: boolean; // overrides the section flag, e.g. a personal view its owner can always manage
}

interface Props {
  home: { count?: number; selected: boolean; onSelect: () => void }; // no count until it is known
  mentions?: { count?: number; selected: boolean; onSelect: () => void }; // docs that mention you
  views: ViewItem[];
  tags: {
    key: string;
    name: string;
    color?: string;
    count: number;
    selected: boolean;
    onSelect: () => void;
  }[];
  onAddView?: () => void; // omitted, no New view is offered
  addViewRef?: React.Ref<HTMLButtonElement>; // anchors what New view opens
  onAddTag: () => void;
  canManage: boolean;
  collapsed: Record<SectionKey, boolean>;
  onToggleSection: (section: SectionKey) => void;
}

// Home, Views and Tags, above the folder tree; rows share FolderTreeItem's size and states.
export function SidebarNav({
  home,
  mentions,
  views,
  tags,
  onAddView,
  addViewRef,
  onAddTag,
  canManage,
  collapsed,
  onToggleSection,
}: Props) {
  const [showAllTags, setShowAllTags] = React.useState(false);
  // A selected tag stays in view even when it ranks below the top five.
  const shownTags = showAllTags
    ? tags
    : tags.filter((t, i) => i < TOP_TAGS || t.selected);

  return (
    <div>
      <div className="space-y-px px-2 pb-[5px] pt-2">
        <NavRow
          lead={<House className="h-[15px] w-[15px]" aria-hidden />}
          name="Home"
          count={home.count}
          selected={home.selected}
          onSelect={home.onSelect}
        />
        {mentions && (
          <NavRow
            lead={<AtSign className="h-[15px] w-[15px]" aria-hidden />}
            name="Mentions"
            count={mentions.count}
            selected={mentions.selected}
            onSelect={mentions.onSelect}
          />
        )}
      </div>

      <Section
        title="Views"
        collapsed={collapsed.views}
        onToggle={() => onToggleSection('views')}
        action={
          canManage &&
          onAddView && (
            <AddButton
              ref={addViewRef}
              label="New view"
              onClick={onAddView}
            />
          )
        }
      >
        {views.length === 0 ? (
          <Hint>Save a filtered list to pin it here</Hint>
        ) : (
          <ul className="space-y-px px-2">
            {views.map((v) => (
              <li key={v.id} className="group relative">
                <NavRow
                  lead={
                    v.shared ? (
                      <Users className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Bookmark className="h-3.5 w-3.5" aria-hidden />
                    )
                  }
                  name={v.name}
                  note={v.shared ? 'shared with everyone' : undefined}
                  count={v.count}
                  selected={v.selected}
                  onSelect={v.onSelect}
                />
                {(v.canManage ?? canManage) &&
                  (v.onRename || v.onCopyLink || v.onDelete) && (
                    <ViewMenu view={v} />
                  )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Tags"
        collapsed={collapsed.tags}
        onToggle={() => onToggleSection('tags')}
        action={canManage && <AddButton label="New tag" onClick={onAddTag} />}
      >
        {tags.length === 0 ? (
          <Hint>Tags you add to documents show here</Hint>
        ) : (
          <ul className="space-y-px px-2">
            {shownTags.map((t) => (
              <li key={t.key}>
                <NavRow
                  lead={<TagDot color={t.color} className="h-2 w-2" />}
                  name={t.name}
                  count={t.count}
                  selected={t.selected}
                  onSelect={t.onSelect}
                />
              </li>
            ))}
            {tags.length > TOP_TAGS && (
              <li>
                <button
                  type="button"
                  onClick={() => setShowAllTags((v) => !v)}
                  className="ml-[30px] block rounded px-2 pt-0.5 text-xs leading-[18px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showAllTags ? 'Show fewer' : `Show all ${tags.length} tags`}
                </button>
              </li>
            )}
          </ul>
        )}
      </Section>
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  headingId?: string;
}

// Shared by Views, Tags and Folders so the three headings line up.
export function SidebarSectionHeader({
  title,
  collapsed,
  onToggle,
  action,
  headingId,
}: SectionHeaderProps) {
  return (
    <div className="mt-2.5 flex h-[30px] items-center justify-between pl-3.5 pr-2.5">
      <h2 id={headingId} className="min-w-0">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="group/section flex items-center gap-1 rounded-sm text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
          <ChevronDown
            aria-hidden
            className={cn(
              'h-3 w-3 transition-[transform,opacity]',
              collapsed
                ? '-rotate-90'
                : 'opacity-0 group-hover/section:opacity-100 group-focus-visible/section:opacity-100',
            )}
          />
        </button>
      </h2>
      {action}
    </div>
  );
}

function Section({
  children,
  ...header
}: Omit<SectionHeaderProps, 'headingId'> & { children: React.ReactNode }) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId}>
      <SidebarSectionHeader {...header} headingId={headingId} />
      {!header.collapsed && children}
    </section>
  );
}

function AddButton({
  label,
  onClick,
  ref,
}: {
  label: string;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-[22px] w-[22px] items-center justify-center rounded text-muted-foreground/80 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus className="h-[13px] w-[13px]" aria-hidden />
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3.5 py-1 text-xs text-muted-foreground">{children}</p>
  );
}

// Sits over the count, fading in on row hover or focus so the row never reflows.
function ViewMenu({ view }: { view: ViewItem }) {
  const { name, onRename, onCopyLink, onDelete } = view;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${name}`}
        className="absolute right-1 top-1/2 flex h-[22px] w-[22px] -translate-y-1/2 items-center justify-center rounded bg-card text-muted-foreground opacity-0 shadow-[0_0_0_1px_hsl(var(--border))] outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Ellipsis className="h-3.5 w-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        {onRename && (
          <DropdownMenuItem onSelect={onRename} className="gap-2">
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            Rename
          </DropdownMenuItem>
        )}
        {onCopyLink && (
          <DropdownMenuItem onSelect={onCopyLink} className="gap-2">
            <Link className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            Copy link
          </DropdownMenuItem>
        )}
        {onDelete && (
          <>
            {(onRename || onCopyLink) && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={onDelete}
              className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface NavRowProps {
  lead: React.ReactNode;
  name: string;
  note?: string; // spoken between the name and the count
  count?: number;
  selected: boolean;
  onSelect: () => void;
}

function NavRow({ lead, name, note, count, selected, onSelect }: NavRowProps) {
  return (
    <button
      type="button"
      aria-label={[name, note, count]
        .filter((part) => part !== undefined)
        .join(', ')}
      aria-current={selected ? 'page' : undefined}
      onClick={onSelect}
      className={cn(
        'flex h-[30px] w-full items-center gap-1.5 rounded-md px-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'bg-selected font-medium text-selected-foreground'
          : 'text-foreground hover:bg-muted/60',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center',
          !selected && 'text-muted-foreground',
        )}
      >
        {lead}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {count !== undefined && (
        <span
          aria-hidden
          className={cn(
            'shrink-0 text-[11.5px] font-normal tabular-nums',
            selected ? 'text-selected-foreground/70' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
