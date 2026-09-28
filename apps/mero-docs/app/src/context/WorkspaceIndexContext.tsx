// One index, one tag list and one presence map per workspace, shared by Home,
// the sidebar and later search. Remount it per workspace so nothing carries over.

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

const WorkspaceIndexContext = createContext<WorkspaceIndex>({
  rows: [],
  folders: [],
  foldersKnown: false,
  folderStatus: {},
  contextOf: () => undefined,
  refetchFolder: () => {},
});

export function useWorkspaceIndexValue(): WorkspaceIndex {
  return useContext(WorkspaceIndexContext);
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
  const tags = useTagsSource(index);
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
          {children}
        </PresenceByDocContext.Provider>
      </TagsContext.Provider>
    </WorkspaceIndexContext.Provider>
  );
}
