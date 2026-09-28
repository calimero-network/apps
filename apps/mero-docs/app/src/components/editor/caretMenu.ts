// The look the menus opened at the caret share: the @ picker and the / menu.

import { useEffect, useRef } from 'react';

export const MENU_PANEL =
  'max-h-[inherit] overflow-y-auto rounded-[10px] border bg-popover text-popover-foreground shadow-md';
export const MENU_LABEL =
  'px-3 pb-1 pt-2.5 text-xs font-medium text-muted-foreground';
export const MENU_ROW =
  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-secondary-foreground aria-selected:bg-selected aria-selected:text-selected-foreground';
export const MENU_ICON = 'h-3.5 w-3.5 shrink-0 text-muted-foreground';
export const MENU_EMPTY = 'px-3 py-2.5 text-[13px] text-muted-foreground';
// BlockNote points the editor's aria-controls and aria-activedescendant at these.
export const MENU_ID = 'bn-suggestion-menu';
export const menuRowId = (index: number) => `${MENU_ID}-item-${index}`;

/** Items in runs of the same group, each with its index in the flat list the keyboard walks. */
export function byGroup<Item extends { group?: string }>(items: Item[]) {
  const groups: { name: string; rows: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const name = item.group ?? '';
    const last = groups[groups.length - 1];
    if (last?.name === name) last.rows.push({ item, index });
    else groups.push({ name, rows: [{ item, index }] });
  });
  return groups;
}

/** A ref for the menu panel that keeps the keyboard's active row in view. */
export function useActiveRowInView(activeIndex: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = ref.current?.querySelectorAll('[role="option"]')[activeIndex];
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);
  return ref;
}
