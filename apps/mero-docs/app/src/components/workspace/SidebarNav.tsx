import * as React from 'react';
import { Bookmark, House, Plus, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TagDot } from '@/components/tags/TagChip';

const TOP_TAGS = 5; // tags listed before "Show all N tags"

interface Props {
  home: { count: number; selected: boolean; onSelect: () => void };
  views: {
    id: string;
    name: string;
    count: number;
    shared: boolean;
    selected: boolean;
    onSelect: () => void;
  }[];
  tags: {
    key: string;
    name: string;
    color?: string;
    count: number;
    selected: boolean;
    onSelect: () => void;
  }[];
  onAddView: () => void;
  onAddTag: () => void;
  canManage: boolean;
}

// Home, Views and Tags, above the folder tree; rows share FolderTreeItem's size and states.
export function SidebarNav({
  home,
  views,
  tags,
  onAddView,
  onAddTag,
  canManage,
}: Props) {
  const [showAllTags, setShowAllTags] = React.useState(false);
  // A selected tag stays in view even when it ranks below the top five.
  const shownTags = showAllTags
    ? tags
    : tags.filter((t, i) => i < TOP_TAGS || t.selected);

  return (
    <div className="pb-1 pt-2">
      <div className="px-3">
        <NavRow
          lead={<House className="h-[15px] w-[15px]" aria-hidden />}
          name="Home"
          count={home.count}
          selected={home.selected}
          onSelect={home.onSelect}
        />
      </div>

      <Section
        title="Views"
        addLabel="New view"
        onAdd={canManage ? onAddView : undefined}
      >
        {views.length === 0 ? (
          <Hint>Save a filtered list to pin it here</Hint>
        ) : (
          <ul className="space-y-1.5 px-3">
            {views.map((v) => (
              <li key={v.id}>
                <NavRow
                  lead={
                    v.shared ? (
                      <Users
                        className="h-3.5 w-3.5"
                        role="img"
                        aria-label="Shared with everyone"
                      />
                    ) : (
                      <Bookmark className="h-3.5 w-3.5" aria-hidden />
                    )
                  }
                  name={v.name}
                  count={v.count}
                  selected={v.selected}
                  onSelect={v.onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Tags"
        addLabel="New tag"
        onAdd={canManage ? onAddTag : undefined}
      >
        {tags.length === 0 ? (
          <Hint>Tags you add to documents show here</Hint>
        ) : (
          <ul className="space-y-1.5 px-3">
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
                  className="ml-[22px] rounded px-2 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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

function Section({
  title,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="mt-2.5">
      <div className="flex h-[30px] items-center justify-between pl-3 pr-2">
        <h2
          id={headingId}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {title}
        </h2>
        {onAdd && (
          <button
            type="button"
            aria-label={addLabel}
            onClick={onAdd}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/80 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-1 text-xs text-muted-foreground">{children}</p>;
}

interface NavRowProps {
  lead: React.ReactNode;
  name: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}

function NavRow({ lead, name, count, selected, onSelect }: NavRowProps) {
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
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
      <span
        className={cn(
          'shrink-0 text-[11.5px] font-normal tabular-nums',
          selected ? 'text-selected-foreground/70' : 'text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}
