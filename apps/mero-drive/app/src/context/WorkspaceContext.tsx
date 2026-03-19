import React, { createContext, useContext, useState } from 'react';

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

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [generalContextId, setGeneralContextId] = useState<string | null>(null);

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
