// Registry context — composes Phase 7's bootstrap + client + tree
// hooks into a single provider so Phase 8 UI components can consume
// `useRegistry()` without wiring the pipeline each time.
//
// Requires WorkspaceProvider + MeroProvider + CalimeroProvider in an
// ancestor (see index.tsx's provider stack).

import React, { createContext, ReactNode, useContext } from 'react';
import { useSubgroups } from '@calimero-network/mero-react';
import type { RegistryClient } from '../api/registry/RegistryClient';
import { useSelfIdentity } from '../hooks/useSelfIdentity';
import { useWorkspaceBootstrap } from '../hooks/useWorkspaceBootstrap';
import { useRegistryClient } from '../hooks/useRegistryClient';
import { useWorkspaceTree, MergedFolder } from '../hooks/useWorkspaceTree';
import { useWorkspace } from './WorkspaceContext';

export interface RegistryState {
  registryContextId: string | null;
  registryClient: RegistryClient | null;
  folders: MergedFolder[];
  loading: boolean;
  error: Error | null;
}

const RegistryCtx = createContext<RegistryState | null>(null);

export function RegistryProvider({ children }: { children: ReactNode }) {
  const { namespaceId, rootGroupId } = useWorkspace();
  const { identity } = useSelfIdentity(namespaceId);
  const { registryContextId, loading: bootLoading, error: bootError } =
    useWorkspaceBootstrap(namespaceId, rootGroupId, identity);
  const registryClient = useRegistryClient(registryContextId, identity);
  const { subgroups, loading: subLoading, error: subError } = useSubgroups(rootGroupId);
  // `subgroups` defaults to an empty array in mero-react's hook
  // initializer but can momentarily be undefined right after a
  // namespace flip (setState on a still-unmounted internal ref),
  // and useWorkspaceTree's memoized `.map(...)` throws if it's not
  // iterable. Default here so the tree renders empty instead of
  // crashing during the create-namespace → first-render window.
  const safeSubgroups = subgroups ?? [];
  const { folders, loading: treeLoading, error: treeError } = useWorkspaceTree(
    rootGroupId,
    registryClient,
    safeSubgroups,
    subLoading,
  );

  const loading = bootLoading || treeLoading;
  const error = bootError ?? subError ?? treeError;

  return (
    <RegistryCtx.Provider
      value={{ registryContextId, registryClient, folders, loading, error }}
    >
      {children}
    </RegistryCtx.Provider>
  );
}

export function useRegistry(): RegistryState {
  const v = useContext(RegistryCtx);
  if (!v) throw new Error('useRegistry outside RegistryProvider');
  return v;
}
