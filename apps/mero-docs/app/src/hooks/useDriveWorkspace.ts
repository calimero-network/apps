// Single top-level workspace hook for mero-docs.
//
// On Calimero 1.0 a workspace is an organization: its members are the
// workspace's members, its teams are the folders (lib/coreFolders), and its
// registry (tags, saved views, managers) is one org-access app instance whose
// id the org's metadata records (`registryApp`), so every member opens the
// same one. Everything below reads from one `GET /orgs/{org}` snapshot and the
// registry instance.
//
// What v1 needed here and 1.0 does not, removed with the port:
// - resolving the application id from the node (instances come from the
//   package, or the dev bundle: `appSource`);
// - discovering the registry context among the namespace's contexts and
//   repairing duplicates (the org metadata pin is the only record);
// - the post-join "syncing from peers" gate and sync status (nothing
//   replicates to a node first: every node reads the cluster's one log);
// - TEE members in the member list (an org holds people only).
//
// Surface (unchanged for consumers):
//   identity:      applicationId, selfIdentity
//   namespaces:    namespaces, selectedNamespaceId, rootGroupId (=== org id),
//                  selectNamespace, clearNamespace
//   creation:      workspaceCreated
//   registry:      registryContextId, registryClient, folders, registryAdmin
//   folder:        selectedFolderId, setSelectedFolder
//   status:        loading, stage, error, refetch

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLive, type GroupMember, type Namespace } from '@/calimero/react';
import { isAppBound, targetKey } from '@calimero-apps/connect';
import { setOrgName } from '@calimero-apps/names';
import { useInstanceRelease, useNodeShieldApp } from '@calimero-apps/passkey';
import { useSession } from '@/calimero/session';
import { REGISTRY_APP_KEY, type OrgView } from '@/calimero/orgs';
import { MeroDocsClient } from '@/lib/docsApi';
import { useContextEvents } from './useContextEvents';
import { useLocalStorage } from './useLocalStorage';
import { useAppRoute } from './useAppRoute';
import { deriveDriveStage, stageHidesContent, type DriveLoadingStage } from '@/lib/driveStage';
import { confirmedNamespace, rememberedOn, syncWorkspaceRoute } from '@/lib/namespaceSelection';
import { type MergedFolder } from './useWorkspaceTree';
import { DEFAULT_NEW_MEMBER_CAPS } from '@/constants/config';
import { foldersOf, type CoreFolder } from '@/lib/coreFolders';
import { folderLabel } from '@/lib/folderLabel';
import { restrictionOf } from '@/lib/folderRestriction';
import { visibleInterval } from '@/utils/visibleInterval';

/** Persisted-namespace localStorage key, holding `{ node, ns }`. Exported so
 *  other call sites (e.g. WorkspacePage's logout cleanup) can clear it. */
export const ACTIVE_NS_KEY = 'mero-drive:activeNs';

/** How often the org (folders, members) is re-read while the window is in
 *  view: core sends no event for another member's folder or member changes. */
const FOLDER_TREE_REFRESH_MS = 30_000;
const NO_FOLDERS: Set<string> = new Set();
const NONE: Namespace[] = [];
const NO_MEMBERS: GroupMember[] = [];
const NO_CORE_FOLDERS: CoreFolder[] = [];

/** Registry-level ownership + managers, fetched once for the whole tree. */
export interface RegistryAdminSlice {
  owner: string | null;
  managers: string[];
  /** Current identity is owner OR manager. */
  isOwnerOrManager: boolean;
  isOwner: boolean;
  loading: boolean;
  error: Error | null;
  addManager: (member: string) => Promise<void>;
  removeManager: (member: string) => Promise<void>;
  refetch: () => void;
}

export type { DriveLoadingStage };

export interface DriveWorkspaceState {
  /** What app instances are created from: the package, or the dev bundle. */
  applicationId: string | null;
  selfIdentity: string | null;
  /** Identity → display name for members of the selected workspace. */
  namespaceMemberNames: Record<string, string>;
  namespaceMembers: {
    members: GroupMember[];
    /** Always empty on 1.0: an organization holds people only. */
    teeMembers: GroupMember[];
    loading: boolean;
    error: Error | null;
  };

  namespaces: Namespace[];
  namespacesListed: boolean;
  namespacesError: Error | null;
  /** Always false on 1.0: a joined workspace is readable at once. */
  isJustJoined: boolean;
  selectedNamespaceId: string | null;
  namespaceId: string | null;
  rootGroupId: string | null;
  selectNamespace: (nsId: string | null) => void;
  clearNamespace: () => void;

  /**
   * Finishes a workspace the node approved: Docs' team, its registry, member
   * defaults, and `selfName` as your name in it. Opens it; throws on failure.
   */
  workspaceCreated: (created: { orgId: string; selfName: string }) => Promise<void>;

  registryContextId: string | null;
  /** Always empty on 1.0: the org metadata records exactly one registry. */
  registryDuplicates: string[];
  /** Always false on 1.0. */
  registryUnsynced: boolean;
  registryClient: MeroDocsClient | null;
  folders: MergedFolder[];
  allFolderNodes: { id: string; parent_id: string | null }[];
  registryFolders: CoreFolder[] | null;
  resolvedFolderIds: Set<string>;
  hiddenFolderIds: Set<string>;
  registryAdmin: RegistryAdminSlice;

  selectedFolderId: string | null;
  setSelectedFolder: (id: string | null, opts?: { replace?: boolean }) => void;

  loading: boolean;
  stage: DriveLoadingStage;
  error: Error | null;
  refetch: () => Promise<void>;
}

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

function useDriveWorkspaceInternal(): DriveWorkspaceState {
  const live = useLive();
  const { session, source } = useSession();
  const admin = live?.admin ?? null;
  const client = live?.client ?? null;
  const selfIdentity = live?.accountId ?? null;
  const applicationId = typeof source === 'string' ? source : source.package;
  const node = session.status === 'signed-in' ? targetKey(session.target) : null;

  // --- Workspace list ---
  const [nsRead, setNsRead] = useState<{ list: Namespace[]; listed: boolean; error: Error | null; loading: boolean }>(
    { list: NONE, listed: false, error: null, loading: false },
  );
  const refetchNamespaces = useCallback(async () => {
    if (!admin) return;
    setNsRead((r) => ({ ...r, loading: true }));
    try {
      const list = await admin.listNamespaces(true);
      setNsRead({ list, listed: true, error: null, loading: false });
    } catch (e) {
      setNsRead((r) => ({ ...r, error: toError(e), loading: false }));
    }
  }, [admin]);
  useEffect(() => {
    setNsRead({ list: NONE, listed: false, error: null, loading: false });
    void refetchNamespaces();
  }, [refetchNamespaces]);
  const namespaces = nsRead.list;

  // --- Selection: the URL names the workspace ---
  const { route, goWorkspace, goFolder, goHome } = useAppRoute();
  const routeNsId = route?.ws ?? null;
  const [storedRaw, setStoredRaw] = useLocalStorage<unknown>(ACTIVE_NS_KEY, null);
  const storedNsId = rememberedOn(storedRaw, node);
  const setStoredNsId = useCallback(
    (nsId: string | null) => setStoredRaw(nsId ? { node, ns: nsId } : null),
    [setStoredRaw, node],
  );
  const userCleared = useRef(false);
  const createdNsId = useRef<string | null>(null);
  const listedNsIds = useMemo(() => namespaces.map((n) => n.namespaceId), [namespaces]);
  const noneJoined = useMemo(() => new Set<string>(), []);
  const selectedNsId = confirmedNamespace({
    answered: nsRead.listed,
    listed: listedNsIds,
    routeNs: routeNsId,
    justJoined: noneJoined,
    created: createdNsId.current,
  });

  useEffect(() => {
    if (userCleared.current) return;
    if (createdNsId.current && listedNsIds.includes(createdNsId.current)) createdNsId.current = null;
    const { goTo, remember, forget } = syncWorkspaceRoute({
      answered: nsRead.listed,
      listed: listedNsIds,
      routeNs: routeNsId,
      stored: storedNsId,
      justJoined: noneJoined,
      created: createdNsId.current,
    });
    if (goTo) goWorkspace(goTo, { replace: true });
    if (remember) setStoredNsId(remember);
    else if (forget) setStoredNsId(null);
  }, [nsRead.listed, listedNsIds, routeNsId, storedNsId, goWorkspace, setStoredNsId, noneJoined]);

  const rootGroupId = selectedNsId;

  // --- The org snapshot: members, folders, the registry pin ---
  const [org, setOrg] = useState<{ id: string; view: OrgView } | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState<Error | null>(null);
  const orgSeq = useRef(0);
  const loadOrg = useCallback(async () => {
    const seq = ++orgSeq.current;
    if (!admin || !selectedNsId) {
      setOrg(null);
      setOrgLoading(false);
      return;
    }
    setOrgLoading(true);
    try {
      const view = await admin.org(selectedNsId, true);
      if (seq !== orgSeq.current) return;
      setOrg((prev) =>
        prev && prev.id === selectedNsId && JSON.stringify(prev.view) === JSON.stringify(view)
          ? prev
          : { id: selectedNsId, view },
      );
      setOrgError(null);
    } catch (e) {
      if (seq === orgSeq.current) setOrgError(toError(e));
    } finally {
      if (seq === orgSeq.current) setOrgLoading(false);
    }
  }, [admin, selectedNsId]);
  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);
  // A write this client made to the org (a folder, a member) re-reads it.
  useEffect(
    () => (admin ? admin.onChange((changed) => changed === selectedNsId && void loadOrg()) : undefined),
    [admin, selectedNsId, loadOrg],
  );
  // A safety net for what no event names (teams and members change on the
  // org): skipped while the tab is hidden, run once on return.
  useEffect(() => {
    if (!selectedNsId) return;
    return visibleInterval(() => void loadOrg(), FOLDER_TREE_REFRESH_MS);
  }, [selectedNsId, loadOrg]);

  const view = org && org.id === selectedNsId ? org.view : null;

  const nsMembers = useMemo<GroupMember[]>(() => {
    if (!view) return NO_MEMBERS;
    return Object.entries(view.members).map(([identity, role]) => {
      const meta = view.memberMetadata[identity] as { name?: unknown } | undefined;
      const name = typeof meta?.name === 'string' && meta.name.trim() ? meta.name.trim() : undefined;
      const groupRole = role === 'owner' || role === 'admin' ? 'Admin' : role === 'guest' ? 'ReadOnly' : 'Member';
      return name ? { identity, role: groupRole, name } : { identity, role: groupRole };
    });
  }, [view]);
  const namespaceMembers = useMemo(
    () => ({ members: nsMembers, teeMembers: NO_MEMBERS, loading: orgLoading && !view, error: orgError }),
    [nsMembers, orgLoading, view, orgError],
  );
  const namespaceMemberNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of nsMembers) if (m.name) out[m.identity] = m.name;
    return out;
  }, [nsMembers]);

  // --- Registry instance ---
  const pinned = view?.metadata[REGISTRY_APP_KEY];
  const registryContextId = typeof pinned === 'string' && pinned ? pinned : null;
  const [regError, setRegError] = useState<Error | null>(null);
  // A workspace whose registry was never created (its creation was cut
  // short): its owner or an admin creates it; anyone else waits for them.
  const healedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!admin || !view || registryContextId || !selfIdentity) return;
    const role = view.members[selfIdentity];
    if (role !== 'owner' && role !== 'admin') return;
    if (healedFor.current === view.orgId) return;
    healedFor.current = view.orgId;
    admin.createContext({ groupId: view.orgId, name: 'Registry' }).catch((e) => setRegError(toError(e)));
  }, [admin, view, registryContextId, selfIdentity]);

  const registryClient = useMemo<MeroDocsClient | null>(
    () => (client && registryContextId ? new MeroDocsClient(client, registryContextId) : null),
    [client, registryContextId],
  );

  const [regOwner, setRegOwner] = useState<string | null>(null);
  const [regManagers, setRegManagers] = useState<string[]>([]);
  const [regAdminLoading, setRegAdminLoading] = useState(false);
  const [regAdminError, setRegAdminError] = useState<Error | null>(null);
  const [regAdminTick, setRegAdminTick] = useState(0);
  useEffect(() => {
    if (!registryClient) {
      setRegOwner(null);
      setRegManagers([]);
      setRegAdminLoading(false);
      setRegAdminError(null);
      return;
    }
    let cancelled = false;
    setRegAdminLoading(true);
    setRegAdminError(null);
    Promise.all([registryClient.getOwner(), registryClient.listManagers()])
      .then(([o, m]) => {
        if (cancelled) return;
        setRegOwner(o && o.length > 0 ? o : null);
        setRegManagers(m ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          console.error('Failed to load registry owner and managers', e);
          setRegAdminError(toError(e));
        }
      })
      .finally(() => {
        if (!cancelled) setRegAdminLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [registryClient, regAdminTick]);

  const refetchRegAdmin = useCallback(() => setRegAdminTick((t) => t + 1), []);
  const addManager = useCallback(
    async (member: string) => {
      if (!registryClient || !member) return;
      await registryClient.addManager({ member });
      setRegAdminTick((t) => t + 1);
    },
    [registryClient],
  );
  const removeManager = useCallback(
    async (member: string) => {
      if (!registryClient || !member) return;
      await registryClient.removeManager({ member });
      setRegAdminTick((t) => t + 1);
    },
    [registryClient],
  );
  const registryAdmin = useMemo<RegistryAdminSlice>(() => {
    const isOwner = !!regOwner && regOwner === selfIdentity;
    const isOwnerOrManager = isOwner || (!!selfIdentity && regManagers.includes(selfIdentity));
    return {
      owner: regOwner,
      managers: regManagers,
      isOwnerOrManager,
      isOwner,
      loading: regAdminLoading,
      error: regAdminError,
      addManager,
      removeManager,
      refetch: refetchRegAdmin,
    };
  }, [regOwner, regManagers, selfIdentity, regAdminLoading, regAdminError, addManager, removeManager, refetchRegAdmin]);

  // --- Folders ---
  const registryFolders = useMemo<CoreFolder[] | null>(() => (view ? foldersOf(view) : null), [view]);
  const regFolders = registryFolders ?? NO_CORE_FOLDERS;
  const resolvedFolderIds = useMemo(() => new Set(regFolders.map((f) => f.id)), [regFolders]);
  const folders = useMemo<MergedFolder[]>(() => {
    if (!rootGroupId) return [];
    const restriction = restrictionOf(regFolders);
    return regFolders.map((f) => ({
      id: f.id,
      parent_id: f.parent_id,
      alias: folderLabel(f.alias),
      visibility: f.visibility,
      color: f.color,
      shared: f.shared,
      restricted: restriction.get(f.id)?.restricted ?? false,
      restrictedBy: restriction.get(f.id)?.by ?? null,
    }));
  }, [rootGroupId, regFolders]);
  const allFolderNodes = useMemo(() => regFolders.map((f) => ({ id: f.id, parent_id: f.parent_id })), [regFolders]);

  const selectedFolderId = route?.folder ?? null;
  // The shield checks the code that runs the open folder's documents, else the workspace's registry.
  const openFolderApp = registryFolders?.find((f) => f.id === selectedFolderId)?.context_id;
  useNodeShieldApp(openFolderApp || registryContextId, source);
  const setSelectedFolder = useCallback(
    (id: string | null, opts?: { replace?: boolean }) => (id ? goFolder(id, opts) : goHome(undefined, opts)),
    [goFolder, goHome],
  );

  // --- A workspace the node approved: its team, the registry, member defaults ---
  const workspaceCreated = useCallback(
    async ({ orgId, selfName }: { orgId: string; selfName: string }): Promise<void> => {
      if (!admin || !client) throw new Error('Not signed in.');
      await admin.finishNamespace(orgId);
      // The registry first: it is what makes the org a workspace of this app.
      await admin.createContext({ groupId: orgId, name: 'Registry' });
      // A passkey step-up the node's consent cannot carry yet, so a session
      // bound to this app skips it; refused, only owners and admins can create
      // folders until the defaults are set.
      if (!(await isAppBound(client))) {
        try {
          await admin.setDefaultCapabilities(orgId, { defaultCapabilities: DEFAULT_NEW_MEMBER_CAPS });
        } catch (e) {
          console.warn('[useDriveWorkspace] member defaults not set; set them in Member defaults.', e);
        }
      }
      // Refused, the workspace stays and the name gate asks for it once on entry.
      if (selfName.trim()) {
        await setOrgName(admin, orgId, admin.self, selfName).catch((e: unknown) =>
          console.warn('[useDriveWorkspace] workspace name for self not set; the gate will ask.', e),
        );
      }
      createdNsId.current = orgId;
      await refetchNamespaces();
      userCleared.current = false;
      goWorkspace(orgId);
      setStoredNsId(orgId);
    },
    [admin, client, refetchNamespaces, goWorkspace, setStoredNsId],
  );

  const selectNamespace = useCallback(
    (nsId: string | null) => {
      userCleared.current = false;
      if (nsId === selectedNsId) return;
      goWorkspace(nsId);
      setStoredNsId(nsId);
    },
    [selectedNsId, goWorkspace, setStoredNsId],
  );
  const clearNamespace = useCallback(() => {
    userCleared.current = true;
    goWorkspace(null);
    setStoredNsId(null);
  }, [goWorkspace, setStoredNsId]);

  const refetch = useCallback(async () => {
    await Promise.all([refetchNamespaces(), loadOrg()]);
    refetchRegAdmin();
  }, [refetchNamespaces, loadOrg, refetchRegAdmin]);

  // The registry instance's events (tags, views, managers) refresh the workspace.
  const onWorkspaceEvent = useCallback(() => {
    void refetch();
  }, [refetch]);
  useContextEvents([registryContextId], onWorkspaceEvent, { strict: true, debounceMs: 300 });

  const stage = deriveDriveStage({
    authLoading: session.status === 'connecting',
    appIdResolving: false,
    isAuthenticated: session.status === 'signed-in',
    hasApplicationId: true,
    nsLoading: nsRead.loading,
    hasSelectedNamespace: !!selectedNsId,
    hasRegistryContext: !!registryContextId,
    membersLoading: orgLoading,
    identityLoading: false,
    hasSelfIdentity: !!selfIdentity,
    subLoading: false,
    regLoading: orgLoading,
    hasLoadedFoldersForNs: !!view,
    awaitingFirstFolderResolve: false,
    isJustJoined: false,
  });
  const loading = stageHidesContent(stage);
  const error = nsRead.error ?? orgError ?? regError ?? null;

  return useMemo<DriveWorkspaceState>(
    () => ({
      applicationId,
      selfIdentity,
      namespaceMemberNames,
      namespaceMembers,
      namespaces,
      namespacesListed: nsRead.listed,
      namespacesError: nsRead.error,
      isJustJoined: false,
      selectedNamespaceId: selectedNsId,
      namespaceId: selectedNsId,
      rootGroupId,
      selectNamespace,
      clearNamespace,
      workspaceCreated,
      registryContextId,
      registryDuplicates: [],
      registryUnsynced: false,
      registryClient,
      folders,
      allFolderNodes,
      registryFolders,
      resolvedFolderIds,
      hiddenFolderIds: NO_FOLDERS,
      registryAdmin,
      selectedFolderId,
      setSelectedFolder,
      loading,
      stage,
      error,
      refetch,
    }),
    [
      applicationId,
      selfIdentity,
      namespaceMemberNames,
      namespaceMembers,
      namespaces,
      nsRead.listed,
      nsRead.error,
      selectedNsId,
      rootGroupId,
      selectNamespace,
      clearNamespace,
      workspaceCreated,
      registryContextId,
      registryClient,
      folders,
      allFolderNodes,
      registryFolders,
      resolvedFolderIds,
      registryAdmin,
      selectedFolderId,
      setSelectedFolder,
      loading,
      stage,
      error,
      refetch,
    ],
  );
}

const DriveWorkspaceContext = createContext<DriveWorkspaceState | null>(null);

export function DriveWorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useDriveWorkspaceInternal();
  // A workspace's registry is the app instance every member of it opens, so
  // the workspace is served the frontend of the release its registry runs.
  // The route names the workspace, so the other release reopens it. Nothing
  // of the workspace renders while the page is leaving.
  const leaving = useInstanceRelease(useLive()?.client, value.registryContextId);
  return createElement(DriveWorkspaceContext.Provider, { value }, leaving ? null : children);
}

export function useDriveWorkspace(): DriveWorkspaceState {
  const ctx = useContext(DriveWorkspaceContext);
  if (!ctx) throw new Error('useDriveWorkspace must be used inside <DriveWorkspaceProvider>');
  return ctx;
}
