// The / menu, drawn in the app's popover look instead of BlockNote's Mantine one.

import { useCallback } from 'react';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import {
  SuggestionMenuController,
  type SuggestionMenuProps,
} from '@blocknote/react';

import { SlashMenu } from '@/components/editor/SlashMenu';
import { SLASH_TRIGGER, slashMenuItems, type SlashItem } from './slashMenu';
import type { DriveEditor } from './schema';

function Menu({
  items,
  selectedIndex,
  onItemClick,
  loadingState,
}: SuggestionMenuProps<SlashItem>) {
  if (loadingState === 'loading-initial') return null;
  return (
    <SlashMenu
      items={items}
      activeIndex={selectedIndex ?? -1}
      onPick={(item) => onItemClick?.(item)}
    />
  );
}

export function EditorSlashMenu({ editor }: { editor: DriveEditor }) {
  const getItems = useCallback(
    async (query: string) =>
      filterSuggestionItems(slashMenuItems(editor), query),
    [editor],
  );
  return (
    <SuggestionMenuController
      triggerCharacter={SLASH_TRIGGER}
      getItems={getItems}
      suggestionMenuComponent={Menu}
      onItemClick={(item: SlashItem) => item.onItemClick()}
    />
  );
}
