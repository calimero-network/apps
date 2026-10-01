// The @ picker: typing @ at a word start mentions a member or links a document.
// The / menu opens it too, or its section mode, which links a heading instead.

import { useCallback, useRef } from 'react';
import {
  SuggestionMenuController,
  type SuggestionMenuProps,
} from '@blocknote/react';
import { toast } from 'sonner';

import { DocLinkPickerMenu } from '@/components/editor/DocLinkPickerMenu';
import { useFolderPaths } from '@/components/home/useHomeChips';
import {
  useTextIndexValue,
  useWorkspaceIndexValue,
} from '@/context/WorkspaceIndexContext';
import { useAppRoute } from '@/hooks/useAppRoute';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderReach } from '@/hooks/useFolderReach';
import { usePresenceByDoc } from '@/hooks/usePresenceByDoc';
import { recentDocs } from '@/hooks/useRecentDocs';
import { normalizeQuery } from '@/lib/search/match';
import { rowKey } from '@/lib/workspaceIndex/types';
import {
  DOC_LINK_TRIGGER,
  opensDocPicker,
  sectionLinkItems,
  type DocLinkItem,
} from './docLinks';
import { mentionPickerItems, pickLinkItem, recentPeople } from './mentions';
import { SECTION_LINK_TRIGGER } from './slashMenu';
import type { DriveEditor } from './schema';

const TEXT_PAUSE_MS = 80; // the text scan waits for a typing pause, as in the search palette

const SectionPickerMenu = (props: SuggestionMenuProps<DocLinkItem>) => (
  <DocLinkPickerMenu {...props} mode="section" />
);

export function DocLinkPicker({ editor }: { editor: DriveEditor }) {
  const { rows, folders } = useWorkspaceIndexValue();
  const { texts } = useTextIndexValue();
  const { route } = useAppRoute();
  const {
    namespaceId,
    selfIdentity,
    namespaceMemberNames,
    namespaceMembers: group,
  } = useDriveWorkspace();
  // A reload or a failed read keeps the last people read for this workspace; none yet leaves People out.
  const lastMembers = useRef<{ ws: string | null; ids: string[] }>({
    ws: null,
    ids: [],
  });
  if (!group.loading && !group.error)
    lastMembers.current = {
      ws: namespaceId,
      ids: group.members.map((m) => m.identity),
    };
  const presence = usePresenceByDoc();
  const canOpen = useFolderReach(route?.folder);
  const paths = useFolderPaths(folders);
  const openKey =
    route?.folder && route.doc ? rowKey(route.folder, route.doc) : undefined;
  const source = {
    ws: namespaceId ?? '',
    current: route ?? undefined,
    rows,
    texts,
    paths,
    self: selfIdentity,
    members:
      lastMembers.current.ws === namespaceId ? lastMembers.current.ids : [],
    names: namespaceMemberNames,
    canOpen,
    present: (openKey ? presence.get(openKey) : undefined) ?? [],
    openKey,
  };
  // Read at query time, so a stable getItems never reloads the open menu under the caret.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const latest = useRef(0);

  const itemsAfterPause = useCallback(
    async (query: string, list: typeof mentionPickerItems) => {
      const mine = ++latest.current;
      if (normalizeQuery(query).text) {
        await new Promise((resolve) => setTimeout(resolve, TEXT_PAUSE_MS));
      }
      const src = sourceRef.current;
      // A newer query is loading, and the menu drops this answer anyway.
      if (mine !== latest.current) return [];
      const workedWith = recentPeople(
        src.openKey,
        src.texts,
        src.present.map((p) => p.id),
        src.rows,
      );
      return list(query, { ...src, recent: recentDocs(src.ws), workedWith });
    },
    [],
  );
  // Changes only when the people offered change, so a join or a name arriving reloads an open menu.
  const peopleKey = source.members
    .map((id) => `${id}=${namespaceMemberNames[id] ?? ''}`)
    .join(',');
  const getDocs = useCallback(
    (query: string) => itemsAfterPause(query, mentionPickerItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- people are read through sourceRef; peopleKey is the reload trigger
    [itemsAfterPause, peopleKey],
  );
  // A new text index gives a new getItems, so an open section menu reloads its headings.
  const getSections = useCallback(
    (query: string) => itemsAfterPause(query, sectionLinkItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- texts is read through sourceRef; listing it is the reload trigger
    [itemsAfterPause, texts],
  );
  const pick = useCallback(
    (item: DocLinkItem) => pickLinkItem(editor, item, toast),
    [editor],
  );

  return (
    <>
      <SuggestionMenuController
        triggerCharacter={DOC_LINK_TRIGGER}
        shouldOpen={opensDocPicker}
        getItems={getDocs}
        suggestionMenuComponent={DocLinkPickerMenu}
        onItemClick={pick}
      />
      <SuggestionMenuController
        triggerCharacter={SECTION_LINK_TRIGGER}
        shouldOpen={() => false}
        getItems={getSections}
        suggestionMenuComponent={SectionPickerMenu}
        onItemClick={pick}
      />
    </>
  );
}
