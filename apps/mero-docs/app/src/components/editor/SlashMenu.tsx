import { type LucideIcon } from 'lucide-react';
import type { SuggestionMenuProps } from '@blocknote/react';

import { Kbd } from '@/components/common/Kbd';
import { shortcutLabel } from '@/lib/platform';
import { CaretMenu } from './CaretMenu';

export interface SlashMenuItem {
  key: string;
  title: string;
  group: string;
  /** Such as `Mod-Alt-1`; shown spelled for this platform. */
  shortcut?: string;
  icon: LucideIcon;
}

// The / menu.
export function SlashMenu<Item extends SlashMenuItem>(
  props: SuggestionMenuProps<Item>,
) {
  return (
    <CaretMenu
      {...props}
      label="Insert"
      empty="No matches"
      className="w-[260px] max-w-[calc(100vw-16px)]"
      row={(item) => ({
        key: item.key,
        icon: item.icon,
        title: item.title,
        trailing: item.shortcut && <Kbd>{shortcutLabel(item.shortcut)}</Kbd>,
      })}
    />
  );
}
