// One index, one tag list, one presence map and one text index per workspace,
// shared by Home, the sidebar and search. Remount it per workspace so nothing carries over.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  useWorkspaceIndex,
  type WorkspaceIndex,
} from '@/hooks/useWorkspaceIndex';
import {
  PresenceByDocContext,
  useFolderPresence,
  type PresenceByDoc,
} from '@/hooks/usePresenceByDoc';
import { TagsContext, useTagsSource } from '@/hooks/useTags';
import { useTextIndex, type TextIndex } from '@/hooks/useTextIndex';

const WorkspaceIndexContext = createContext<WorkspaceIndex>({
  rows: [],
  folders: [],
  folderStatus: {},
  contextOf: () => undefined,
  refetchFolder: () => {},
});

// Its own context: the text index changes as each doc is read, and only search reads it.
const TextIndexContext = createContext<TextIndex>({
  texts: new Map(),
  foldersDone: 0,
  foldersTotal: 0,
  pending: [],
  failed: [],
});

export function useWorkspaceIndexValue(): WorkspaceIndex {
  return useContext(WorkspaceIndexContext);
}

export function useTextIndexValue(): TextIndex {
  return useContext(TextIndexContext);
}

type ReportPresence = (folderId: string, byDoc: PresenceByDoc | null) => void;

// A hook per docs context, and the number of contexts changes, so each gets a component.
function FolderPresence({
  folderId,
  contextId,
  report,
}: {
  folderId: string;
  contextId: string;
  report: ReportPresence;
}) {
  const byDoc = useFolderPresence(folderId, contextId);
  useEffect(() => report(folderId, byDoc), [folderId, byDoc, report]);
  useEffect(() => () => report(folderId, null), [folderId, report]);
  return null;
}

export function WorkspaceIndexProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const index = useWorkspaceIndex();
  const tags = useTagsSource();
  const texts = useTextIndex(index);
  const [byFolder, setByFolder] = useState<Record<string, PresenceByDoc>>({});
  const report = useCallback<ReportPresence>((folderId, byDoc) => {
    setByFolder((prev) => {
      if (byDoc) return { ...prev, [folderId]: byDoc };
      const { [folderId]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);
  const presence = useMemo<PresenceByDoc>(
    () => new Map(Object.values(byFolder).flatMap((m) => [...m])),
    [byFolder],
  );
  // Only a context this node has joined and read can carry presence.
  const joined = index.folders.filter(
    (f) => index.folderStatus[f.id] === 'ready' && index.contextOf(f.id),
  );

  return (
    <WorkspaceIndexContext.Provider value={index}>
      <TagsContext.Provider value={tags}>
        <PresenceByDocContext.Provider value={presence}>
          {joined.map((f) => (
            <FolderPresence
              key={f.id}
              folderId={f.id}
              contextId={index.contextOf(f.id)!}
              report={report}
            />
          ))}
          <TextIndexContext.Provider value={texts}>
            {children}
          </TextIndexContext.Provider>
        </PresenceByDocContext.Provider>
      </TagsContext.Provider>
    </WorkspaceIndexContext.Provider>
  );
}
