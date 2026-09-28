// The @ picker: typing @ at a word start links a document. The / menu opens
// it too, or its section mode, which links a heading instead.

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
import { recentDocs } from '@/hooks/useRecentDocs';
import { normalizeQuery } from '@/lib/search/match';
import {
  DOC_LINK_TRIGGER,
  docLinkItems,
  insertDocLink,
  opensDocPicker,
  sectionLinkItems,
  type DocLinkItem,
} from './docLinks';
import { SECTION_LINK_TRIGGER, typedNever } from './slashMenu';
import type { DriveEditor } from './schema';

const TEXT_PAUSE_MS = 80; // the text scan waits for a typing pause, as in the search palette

type PickerMenuProps = SuggestionMenuProps<DocLinkItem> & {
  mode?: 'doc' | 'section';
};

function PickerMenu({
  mode,
  items,
  selectedIndex,
  onItemClick,
  loadingState,
}: PickerMenuProps) {
  if (loadingState === 'loading-initial') return null;
  return (
    <DocLinkPickerMenu
      mode={mode}
      items={items}
      activeIndex={selectedIndex ?? -1}
      onPick={(item) => onItemClick?.(item as DocLinkItem)}
    />
  );
}

const SectionPickerMenu = (props: PickerMenuProps) => (
  <PickerMenu {...props} mode="section" />
);

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

  const itemsAfterPause = useCallback(
    async (query: string, list: typeof docLinkItems) => {
      const mine = ++latest.current;
      if (normalizeQuery(query).text) {
        await new Promise((resolve) => setTimeout(resolve, TEXT_PAUSE_MS));
      }
      const src = sourceRef.current;
      // A newer query is loading, and the menu drops this answer anyway.
      return mine === latest.current
        ? list(query, { ...src, recent: recentDocs(src.ws) })
        : [];
    },
    [],
  );
  const getDocs = useCallback(
    (query: string) => itemsAfterPause(query, docLinkItems),
    [itemsAfterPause],
  );
  // A new text index gives a new getItems, so an open section menu reloads its headings.
  const getSections = useCallback(
    (query: string) => itemsAfterPause(query, sectionLinkItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- texts is read through sourceRef; listing it is the reload trigger
    [itemsAfterPause, texts],
  );
  const pick = useCallback(
    (item: DocLinkItem) => insertDocLink(editor, item),
    [editor],
  );

  return (
    <>
      <SuggestionMenuController
        triggerCharacter={DOC_LINK_TRIGGER}
        shouldOpen={opensDocPicker}
        getItems={getDocs}
        suggestionMenuComponent={PickerMenu}
        onItemClick={pick}
      />
      <SuggestionMenuController
        triggerCharacter={SECTION_LINK_TRIGGER}
        shouldOpen={typedNever}
        getItems={getSections}
        suggestionMenuComponent={SectionPickerMenu}
        onItemClick={pick}
      />
    </>
  );
}
