// The / menu, drawn in the app's popover look instead of BlockNote's Mantine one.

import { useCallback } from 'react';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { SuggestionMenuController } from '@blocknote/react';

import { SlashMenu } from '@/components/editor/SlashMenu';
import { SLASH_TRIGGER, slashMenuItems, type SlashItem } from './slashMenu';
import type { DriveEditor } from './schema';

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
      suggestionMenuComponent={SlashMenu}
      onItemClick={(item: SlashItem) => item.onItemClick()}
    />
  );
}
