// The [[ picker. BlockNote compares a multi-character trigger against one
// character too many, so the trigger is [ and it opens only after another [.

import { useCallback, useRef } from 'react';
import {
  SuggestionMenuController,
  type SuggestionMenuProps,
} from '@blocknote/react';

import { DocLinkPickerMenu } from '@/components/editor/DocLinkPickerMenu';
import { useFolderPaths } from '@/components/home/useHomeChips';
import {
  useTextIndexValue,
  useWorkspaceIndexValue,
} from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { normalizeQuery } from '@/lib/search/match';
import {
  DOC_LINK_TRIGGER,
  docLinkItems,
  insertDocLink,
  opensDocPicker,
  type DocLinkItem,
} from './docLinks';
import type { DriveEditor } from './schema';

const TEXT_PAUSE_MS = 80; // the text scan waits for a typing pause, as in the search palette

function PickerMenu({
  items,
  selectedIndex,
  onItemClick,
  loadingState,
}: SuggestionMenuProps<DocLinkItem>) {
  if (loadingState === 'loading-initial') return null;
  return (
    <DocLinkPickerMenu
      items={items}
      activeIndex={selectedIndex ?? -1}
      onPick={(item) => onItemClick?.(item as DocLinkItem)}
    />
  );
}

export function DocLinkPicker({ editor }: { editor: DriveEditor }) {
  const { rows, folders } = useWorkspaceIndexValue();
  const { texts } = useTextIndexValue();
  const { route } = useAppRoute();
  const { namespaceId } = useDriveWorkspace();
  const paths = useFolderPaths(folders);
  const source = {
    ws: namespaceId ?? '',
    current: route ?? undefined,
    rows,
    texts,
    paths,
  };
  // Read at query time, so a stable getItems never reloads the open menu under the caret.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const latest = useRef(0);

  const getItems = useCallback(async (query: string) => {
    const mine = ++latest.current;
    if (normalizeQuery(query).text) {
      await new Promise((resolve) => setTimeout(resolve, TEXT_PAUSE_MS));
    }
    // A newer query is loading, and the menu drops this answer anyway.
    return mine === latest.current
      ? docLinkItems(query, sourceRef.current)
      : [];
  }, []);

  return (
    <SuggestionMenuController
      triggerCharacter={DOC_LINK_TRIGGER}
      shouldOpen={opensDocPicker}
      getItems={getItems}
      suggestionMenuComponent={PickerMenu}
      onItemClick={(item: DocLinkItem) =>
        insertDocLink(editor, item, { fromPicker: true })
      }
    />
  );
}
