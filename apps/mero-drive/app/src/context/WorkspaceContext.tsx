import React, { createContext, useContext, useEffect, useState } from 'react';

const WORKSPACE_STORAGE_KEY = 'mero-drive-workspace-v1';

interface WorkspaceState {
  activeGroupId: string | null;
  activeContextId: string | null;
  generalContextId: string | null;
  setActiveContext: (contextId: string) => void;
  setActiveWorkspace: (groupId: string, generalContextId: string) => void;
}

const defaultState: WorkspaceState = {
  activeGroupId: null,
  activeContextId: null,
  generalContextId: null,
  setActiveContext: () => {},
  setActiveWorkspace: () => {},
};

export const WorkspaceContext = createContext<WorkspaceState>(defaultState);

function readPersistedWorkspace(): {
  activeGroupId: string | null;
  activeContextId: string | null;
  generalContextId: string | null;
} {
  if (typeof window === 'undefined') {
    return { activeGroupId: null, activeContextId: null, generalContextId: null };
  }
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return { activeGroupId: null, activeContextId: null, generalContextId: null };
    }
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      activeGroupId: typeof p.activeGroupId === 'string' ? p.activeGroupId : null,
      activeContextId: typeof p.activeContextId === 'string' ? p.activeContextId : null,
      generalContextId: typeof p.generalContextId === 'string' ? p.generalContextId : null,
    };
  } catch {
    return { activeGroupId: null, activeContextId: null, generalContextId: null };
  }
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const persisted = readPersistedWorkspace();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(persisted.activeGroupId);
  const [activeContextId, setActiveContextId] = useState<string | null>(persisted.activeContextId);
  const [generalContextId, setGeneralContextId] = useState<string | null>(persisted.generalContextId);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(
        WORKSPACE_STORAGE_KEY,
        JSON.stringify({ activeGroupId, activeContextId, generalContextId }),
      );
    } catch {
      // best-effort
    }
  }, [activeGroupId, activeContextId, generalContextId]);

  const setActiveContext = (contextId: string) => {
    setActiveContextId(contextId);
  };

  const setActiveWorkspace = (groupId: string, newGeneralContextId: string) => {
    setActiveGroupId(groupId);
    setGeneralContextId(newGeneralContextId);
    setActiveContextId(newGeneralContextId);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        activeGroupId,
        activeContextId,
        generalContextId,
        setActiveContext,
        setActiveWorkspace,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = (): WorkspaceState => useContext(WorkspaceContext);
