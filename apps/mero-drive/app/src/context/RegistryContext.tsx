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

export type RegistryLoadingStage =
  | 'idle'
  | 'resolving-identity'
  | 'bootstrapping-registry'
  | 'loading-subgroups'
  | 'loading-folders'
  | 'ready';

export interface RegistryState {
  registryContextId: string | null;
  registryClient: RegistryClient | null;
  folders: MergedFolder[];
  loading: boolean;
  stage: RegistryLoadingStage;
  error: Error | null;
}

const RegistryCtx = createContext<RegistryState | null>(null);

export function RegistryProvider({ children }: { children: ReactNode }) {
  const { namespaceId, rootGroupId } = useWorkspace();
  const {
    identity,
    loading: identityLoading,
    error: identityError,
  } = useSelfIdentity(namespaceId);
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

  // Fine-grained stage so the UI can show WHAT we're waiting on
  // rather than a generic "Loading folders…". Order matches the
  // data-flow chain (identity → bootstrap → subgroups → tree).
  let stage: RegistryLoadingStage = 'ready';
  if (!namespaceId) stage = 'idle';
  else if (identityLoading || !identity) stage = 'resolving-identity';
  else if (bootLoading || !registryContextId) stage = 'bootstrapping-registry';
  else if (subLoading) stage = 'loading-subgroups';
  else if (treeLoading) stage = 'loading-folders';

  const loading = stage !== 'ready' && stage !== 'idle';
  // Surface errors from EVERY stage so a silent failure in identity
  // resolution or alias bootstrap doesn't leave the UI stuck on the
  // loading spinner forever.
  const error = identityError ?? bootError ?? subError ?? treeError;

  return (
    <RegistryCtx.Provider
      value={{ registryContextId, registryClient, folders, loading, stage, error }}
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
