// The menu opened at the caret, shared by the @ picker and the / menu, drawn
// as a BlockNote suggestion menu in the app's popover look.

import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import type { SuggestionMenuProps } from '@blocknote/react';

import { cn } from '@/lib/utils';

const MENU_PANEL =
  'max-h-[inherit] overflow-y-auto rounded-[10px] border bg-popover text-popover-foreground shadow-md';
const MENU_LABEL = 'px-3 pb-1 pt-2.5 text-xs font-medium text-muted-foreground';
const MENU_ROW =
  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-secondary-foreground aria-selected:bg-selected aria-selected:text-selected-foreground';
const MENU_ICON = 'h-3.5 w-3.5 shrink-0 text-muted-foreground';
const MENU_EMPTY = 'px-3 py-2.5 text-[13px] text-muted-foreground';
// BlockNote points the editor's aria-controls and aria-activedescendant at these.
const MENU_ID = 'bn-suggestion-menu';
const menuRowId = (index: number) => `${MENU_ID}-item-${index}`;

export interface CaretMenuRow {
  key: string;
  icon: LucideIcon;
  title: React.ReactNode;
  trailing?: React.ReactNode;
}

type CaretMenuProps<Item> = SuggestionMenuProps<Item> & {
  label: string; // names the list
  showLabel?: boolean; // heads the list while its rows are not grouped
  empty: string;
  className: string; // the panel's width
  row: (item: Item) => CaretMenuRow;
};

/** Items in runs of the same group, each with its index in the flat list the keyboard walks. */
function byGroup<Item extends { group?: string }>(items: Item[]) {
  const groups: { name: string; rows: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const name = item.group ?? '';
    const last = groups[groups.length - 1];
    if (last?.name === name) last.rows.push({ item, index });
    else groups.push({ name, rows: [{ item, index }] });
  });
  return groups;
}

// The editor's suggestion controller owns the keyboard, so the active row is controlled.
export function CaretMenu<Item extends { group?: string }>({
  items,
  selectedIndex,
  onItemClick,
  loadingState,
  label,
  showLabel = false,
  empty,
  className,
  row,
}: CaretMenuProps<Item>) {
  const labelId = React.useId();
  const ref = React.useRef<HTMLDivElement>(null);
  const activeIndex = selectedIndex ?? -1;
  React.useEffect(() => {
    const active =
      ref.current?.querySelectorAll('[role="option"]')[activeIndex];
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);
  if (loadingState === 'loading-initial') return null;

  const headed = showLabel && !items.some((item) => item.group);
  const renderRow = ({ item, index }: { item: Item; index: number }) => {
    const { key, icon: Icon, title, trailing } = row(item);
    return (
      <div
        key={key}
        id={menuRowId(index)}
        role="option"
        aria-selected={index === activeIndex}
        className={MENU_ROW}
        // The caret stays in the document while the menu is open.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onItemClick?.(item)}
      >
        <Icon aria-hidden className={MENU_ICON} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {trailing}
      </div>
    );
  };
  return (
    <div ref={ref} className={cn(MENU_PANEL, className)}>
      <div id={labelId} className={headed ? MENU_LABEL : 'sr-only'}>
        {label}
      </div>
      {items.length === 0 ? (
        <div className={cn(MENU_EMPTY, headed && 'pt-1')}>{empty}</div>
      ) : (
        <div
          role="listbox"
          id={MENU_ID}
          aria-labelledby={labelId}
          className="px-1 pb-1"
        >
          {byGroup(items).map(({ name, rows }) =>
            name ? (
              <div key={name} role="group" aria-label={name}>
                <div aria-hidden className={cn(MENU_LABEL, 'px-2')}>
                  {name}
                </div>
                {rows.map(renderRow)}
              </div>
            ) : (
              <React.Fragment key="">{rows.map(renderRow)}</React.Fragment>
            ),
          )}
        </div>
      )}
    </div>
  );
}
