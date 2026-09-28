import { type LucideIcon } from 'lucide-react';

import { Kbd } from '@/components/common/Kbd';
import { cn } from '@/lib/utils';
import { shortcutLabel } from '@/lib/platform';
import {
  MENU_EMPTY,
  MENU_ICON,
  MENU_ID,
  MENU_LABEL,
  MENU_PANEL,
  MENU_ROW,
  menuRowId,
  useActiveRowInView,
} from './caretMenu';

export interface SlashMenuItem {
  key: string;
  title: string;
  group: string;
  /** Such as `Mod-Alt-1`; shown spelled for this platform. */
  shortcut?: string;
  icon: LucideIcon;
}

interface SlashMenuProps<Item extends SlashMenuItem> {
  items: Item[];
  activeIndex: number;
  onPick: (item: Item) => void;
}

/** Items in runs of the same group, each with its index in the flat list the keyboard walks. */
function byGroup<Item extends SlashMenuItem>(items: Item[]) {
  const groups: { name: string; rows: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last?.name === item.group) last.rows.push({ item, index });
    else groups.push({ name: item.group, rows: [{ item, index }] });
  });
  return groups;
}

// The / menu. The editor's suggestion controller owns the keyboard, so the active row is controlled.
export function SlashMenu<Item extends SlashMenuItem>({
  items,
  activeIndex,
  onPick,
}: SlashMenuProps<Item>) {
  const ref = useActiveRowInView(activeIndex);
  return (
    <div
      ref={ref}
      className={cn(MENU_PANEL, 'w-[260px] max-w-[calc(100vw-16px)]')}
    >
      {items.length === 0 ? (
        <div className={MENU_EMPTY}>No matches</div>
      ) : (
        <div role="listbox" id={MENU_ID} aria-label="Insert" className="pb-1">
          {byGroup(items).map((group) => (
            <div key={group.name} role="group" aria-label={group.name}>
              <div aria-hidden className={MENU_LABEL}>
                {group.name}
              </div>
              <div className="px-1">
                {group.rows.map(({ item, index }) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.key}
                      id={menuRowId(index)}
                      role="option"
                      aria-selected={index === activeIndex}
                      className={MENU_ROW}
                      // The caret stays in the document while the menu is open.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onPick(item)}
                    >
                      <Icon aria-hidden className={MENU_ICON} />
                      <span className="min-w-0 flex-1 truncate">
                        {item.title}
                      </span>
                      {item.shortcut && (
                        <Kbd>{shortcutLabel(item.shortcut)}</Kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
