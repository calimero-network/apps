// Workspace context — tracks which namespace/root group the user is
// currently operating in, plus the selected folder for the
// right-pane detail view. Persists namespace selection to
// localStorage so a reload returns to the same workspace.
//
// Selected folder is session-only; clearing localStorage on logout
// doesn't need to touch it.

import React, {
  createContext,
  ReactNode,
  useContext,
  useState,
  useCallback,
} from 'react';

const NS_KEY = 'mero-drive:activeNs';
const ROOT_KEY = 'mero-drive:activeRoot';

export interface Workspace {
  namespaceId: string | null;
  rootGroupId: string | null;
  selectedFolderId: string | null;
  setNamespace: (namespaceId: string, rootGroupId: string) => void;
  clearNamespace: () => void;
  setSelectedFolder: (id: string | null) => void;
}

const WorkspaceCtx = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [namespaceId, setNs] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : localStorage.getItem(NS_KEY),
  );
  const [rootGroupId, setRoot] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : localStorage.getItem(ROOT_KEY),
  );
  const [selectedFolderId, setSelected] = useState<string | null>(null);

  const setNamespace = useCallback((ns: string, root: string) => {
    localStorage.setItem(NS_KEY, ns);
    localStorage.setItem(ROOT_KEY, root);
    setNs(ns);
    setRoot(root);
    setSelected(null);
  }, []);

  const clearNamespace = useCallback(() => {
    localStorage.removeItem(NS_KEY);
    localStorage.removeItem(ROOT_KEY);
    setNs(null);
    setRoot(null);
    setSelected(null);
  }, []);

  return (
    <WorkspaceCtx.Provider
      value={{
        namespaceId,
        rootGroupId,
        selectedFolderId,
        setNamespace,
        clearNamespace,
        setSelectedFolder: setSelected,
      }}
    >
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace(): Workspace {
  const v = useContext(WorkspaceCtx);
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider');
  return v;
}
