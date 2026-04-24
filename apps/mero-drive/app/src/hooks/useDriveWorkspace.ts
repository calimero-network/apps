// Single top-level workspace hook for mero-drive.
//
// Replaces WorkspaceContext + RegistryContext + useWorkspaceBootstrap
// + useSelfIdentity (~440 lines across four files) with ~180 lines
// modeled on battleships' useBattleshipsLobby.
//
// Architectural simplification: the Registry context is created
// atomically with the namespace (in `createWorkspace`), so every
// namespace this app produces has exactly one context in its root
// group from day one. We then discover the Registry context id via
// `useGroupContexts(namespaceId)[0]` — the same "first context in
// the root group" convention battleships uses for its lobby context.
// This eliminates the alias-lookup + lazy-create + cross-tab race
// dance that the old `useWorkspaceBootstrap` needed.
//
// Per-namespace identity comes from `useGroupMembers(ns).selfIdentity`
// — the mero-react primitive. No custom fetch, no localStorage cache,
// no mero-js unwrap() workaround needed.
//
// Surface (everything a consumer used to need from useWorkspace +
// useRegistry + useSelfIdentity is now on this one hook):
//
//   identity:
//     applicationId, selfIdentity
//   namespace list + selection:
//     namespaces, selectedNamespaceId, rootGroupId (=== selected id),
//     selectNamespace, clearNamespace
//   creation:
//     createWorkspace, createWorkspaceLoading, createWorkspaceError
//   registry:
//     registryContextId, registryClient, folders
//   selected folder (UI-only):
//     selectedFolderId, setSelectedFolder
//   status:
//     loading, stage, error, refetch

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMero,
  useNamespacesForApplication,
  useGroupContexts,
  useGroupMembers,
  useSubgroups,
  type Namespace,
} from '@calimero-network/mero-react';
import { RegistryClient } from '../api/registry/RegistryClient';
import { useLocalStorage } from './useLocalStorage';
import {
  mergeAdminAndRegistry,
  type AdminSubgroup,
  type MergedFolder,
  type RegistryFolderShape,
} from './useWorkspaceTree';
import { ENV_APPLICATION_ID, REGISTRY_SERVICE_ID } from '@/constants/config';

const ACTIVE_NS_KEY = 'mero-drive:activeNs';

export type DriveLoadingStage =
  | 'idle'
  | 'awaiting-auth'
  | 'resolving-namespaces'
  | 'resolving-registry-context'
  | 'loading-subgroups'
  | 'loading-folders'
  | 'ready';

export interface DriveWorkspaceState {
  // identity
  applicationId: string | null;
  selfIdentity: string | null;

  // namespace list + selection
  namespaces: Namespace[];
  selectedNamespaceId: string | null;
  /** Alias of selectedNamespaceId. namespaceId was the field name on
   *  the old WorkspaceContext; keeping it avoids a cascading rename
   *  across every consumer. */
  namespaceId: string | null;
  rootGroupId: string | null;
  selectNamespace: (nsId: string | null) => void;
  clearNamespace: () => void;

  // creation (namespace + registry context atomically)
  createWorkspace: (alias: string) => Promise<string | null>;
  createWorkspaceLoading: boolean;
  createWorkspaceError: Error | null;

  // registry
  registryContextId: string | null;
  registryClient: RegistryClient | null;
  folders: MergedFolder[];

  // selected folder (UI-only; not persisted)
  selectedFolderId: string | null;
  setSelectedFolder: (id: string | null) => void;

  // status
  loading: boolean;
  stage: DriveLoadingStage;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useDriveWorkspace(): DriveWorkspaceState {
  const {
    mero,
    applicationId: authApplicationId,
    contextIdentity,
    isAuthenticated,
    isLoading: authLoading,
  } = useMero();
  const applicationId = authApplicationId || ENV_APPLICATION_ID || null;

  // --- Namespace list + persisted selection ---
  const {
    namespaces,
    loading: nsLoading,
    error: nsError,
    refetch: refetchNamespaces,
  } = useNamespacesForApplication(applicationId ?? undefined);

  const [selectedNsId, setSelectedNsId] = useLocalStorage<string | null>(
    ACTIVE_NS_KEY,
    null,
  );

  // Auto-select a namespace when the list lands and we don't have a
  // valid selection. Fall back to [0] if the persisted id isn't in
  // the list (deleted remotely, user cleared storage, etc.).
  const userCleared = useRef(false);
  useEffect(() => {
    if (namespaces.length === 0) return;
    if (userCleared.current) return;
    if (selectedNsId && namespaces.some((n) => n.namespaceId === selectedNsId)) {
      return;
    }
    setSelectedNsId(namespaces[0].namespaceId);
  }, [namespaces, selectedNsId, setSelectedNsId]);

  const rootGroupId = selectedNsId;

  // --- Per-namespace identity via mero-react's primitive ---
  const { selfIdentity, loading: membersLoading } = useGroupMembers(
    selectedNsId ?? undefined,
  );

  // --- Registry context discovery ---
  // The Registry context is the first context in the namespace's root
  // group, by convention established in createWorkspace below.
  const {
    contexts,
    loading: contextsLoading,
    refetch: refetchContexts,
  } = useGroupContexts(selectedNsId ?? undefined);
  const registryContextId = contexts.length > 0 ? contexts[0].contextId : null;

  // --- Registry client (memoized) ---
  const registryClient = useMemo<RegistryClient | null>(() => {
    if (!mero || !registryContextId || !selfIdentity) return null;
    return new RegistryClient(mero, registryContextId, selfIdentity);
  }, [mero, registryContextId, selfIdentity]);

  // --- Subgroups (admin-side folder tree) ---
  const {
    subgroups,
    loading: subLoading,
  } = useSubgroups(selectedNsId ?? undefined);

  // --- Registry-side folder metadata ---
  const [regFolders, setRegFolders] = useState<RegistryFolderShape[]>([]);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<Error | null>(null);

  useEffect(() => {
    if (!registryClient) {
      setRegFolders([]);
      setRegLoading(false);
      return;
    }
    let alive = true;
    setRegLoading(true);
    setRegError(null);
    registryClient
      .getFolders()
      .then((fs) => {
        if (!alive) return;
        setRegFolders(
          fs.map((f) => ({
            id: f.id,
            parent_id: f.parent_id ?? null,
            visibility: f.visibility as 'Inherit' | 'Restricted',
            color: f.color ?? null,
          })),
        );
        setRegLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setRegError(e instanceof Error ? e : new Error(String(e)));
        setRegLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [registryClient]);

  // --- Merge admin subgroups with registry metadata ---
  const folders = useMemo<MergedFolder[]>(() => {
    if (!rootGroupId) return [];
    const regById = new Map(regFolders.map((r) => [r.id, r]));
    const safe = subgroups ?? [];
    const admin: AdminSubgroup[] = safe.map((s) => {
      const fromReg = regById.get(s.groupId);
      return {
        groupId: s.groupId,
        parent_id: fromReg ? fromReg.parent_id : rootGroupId,
        alias: s.alias,
      };
    });
    return mergeAdminAndRegistry(admin, regFolders, rootGroupId).folders;
  }, [rootGroupId, subgroups, regFolders]);

  // --- Selected folder (UI-only, not persisted) ---
  const [selectedFolderId, setSelectedFolderState] = useState<string | null>(null);
  // Clear selected folder when the active namespace changes — stale
  // IDs across namespaces leak the wrong folder into the right pane.
  useEffect(() => {
    setSelectedFolderState(null);
  }, [selectedNsId]);

  const setSelectedFolder = useCallback((id: string | null) => {
    setSelectedFolderState(id);
  }, []);

  // --- Mutations ---
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<Error | null>(null);

  const createWorkspace = useCallback(
    async (alias: string): Promise<string | null> => {
      if (!mero || !applicationId) return null;
      setCreateLoading(true);
      setCreateError(null);
      try {
        // Step 1 — create the namespace (root group).
        const ns = await mero.admin.createNamespace({
          applicationId,
          upgradePolicy: 'Automatic',
          alias,
        });
        if (!ns?.namespaceId) {
          throw new Error('createNamespace returned no namespaceId');
        }
        // Step 2 — seed the Registry context inside the namespace's
        // root group. This is the convention the rest of the hook
        // relies on: contexts[0] === Registry context.
        await mero.admin.createContext({
          applicationId,
          groupId: ns.namespaceId,
          serviceName: REGISTRY_SERVICE_ID,
          initializationParams: [],
        });
        await refetchNamespaces();
        userCleared.current = false;
        setSelectedNsId(ns.namespaceId);
        return ns.namespaceId;
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        setCreateError(err);
        return null;
      } finally {
        setCreateLoading(false);
      }
    },
    [mero, applicationId, refetchNamespaces, setSelectedNsId],
  );

  const selectNamespace = useCallback(
    (nsId: string | null) => {
      userCleared.current = false;
      setSelectedNsId(nsId);
    },
    [setSelectedNsId],
  );

  const clearNamespace = useCallback(() => {
    userCleared.current = true;
    setSelectedNsId(null);
  }, [setSelectedNsId]);

  const refetch = useCallback(async () => {
    await refetchNamespaces();
    await refetchContexts();
  }, [refetchNamespaces, refetchContexts]);

  // --- Stage derivation for loading-indicator UX ---
  let stage: DriveLoadingStage = 'ready';
  if (authLoading) stage = 'awaiting-auth';
  else if (!isAuthenticated || !applicationId) stage = 'awaiting-auth';
  else if (nsLoading) stage = 'resolving-namespaces';
  else if (!selectedNsId) stage = 'idle';
  else if (contextsLoading || !registryContextId || membersLoading || !selfIdentity)
    stage = 'resolving-registry-context';
  else if (subLoading) stage = 'loading-subgroups';
  else if (regLoading) stage = 'loading-folders';

  const loading = stage !== 'ready' && stage !== 'idle';
  const error = nsError ?? regError ?? null;

  return {
    applicationId,
    selfIdentity: selfIdentity ?? contextIdentity ?? null,

    namespaces,
    selectedNamespaceId: selectedNsId,
    namespaceId: selectedNsId,
    rootGroupId,
    selectNamespace,
    clearNamespace,

    createWorkspace,
    createWorkspaceLoading: createLoading,
    createWorkspaceError: createError,

    registryContextId,
    registryClient,
    folders,

    selectedFolderId,
    setSelectedFolder,

    loading,
    stage,
    error,
    refetch,
  };
}
