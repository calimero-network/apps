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
//     registryContextId, registryClient, folders, registryAdmin
//   selected folder (UI-only):
//     selectedFolderId, setSelectedFolder
//   status:
//     loading, stage, error, refetch

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
import {
  DEFAULT_NEW_MEMBER_CAPS,
  ENV_APPLICATION_ID,
  REGISTRY_SERVICE_ID,
} from '@/constants/config';

const ACTIVE_NS_KEY = 'mero-drive:activeNs';
// SessionStorage-only so it doesn't persist across tabs or reloads
// once sync settles. Set by JoinPage on successful joinNamespace /
// joinGroup; the first time the namespace reaches a ready state in
// useDriveWorkspace, the flag is cleared and we stop gating.
const JUST_JOINED_KEY = 'mero-drive:justJoined';
// How long to keep showing "Syncing workspace…" before surfacing a
// "taking longer than expected" hint. The governance op + registry
// state typically land in <1s on a healthy mesh; the upper bound
// exists so a flaky peer doesn't leave the UI pinned forever.
const JUST_JOINED_WATCHDOG_MS = 30_000;

/** Registry-level ownership + managers, hoisted onto the workspace
 *  state so it's fetched ONCE for the whole folder tree (was N×getOwner
 *  + N×listManagers when every FolderContextMenu row called
 *  `useRegistryAdmin` directly). `useRegistryAdmin()` now just reads
 *  this slice from context. */
export interface RegistryAdminSlice {
  /** Registry owner identity, or `null` when unclaimed. */
  owner: string | null;
  managers: string[];
  /** Current identity is owner OR manager — gates writing folder roles /
   *  the sharing-panel admin section (`canManagePermissions`). */
  isOwnerOrManager: boolean;
  /** Current identity is the owner — managers can't add/remove managers. */
  isOwner: boolean;
  loading: boolean;
  error: Error | null;
  addManager: (member: string) => Promise<void>;
  removeManager: (member: string) => Promise<void>;
  /** Claim the owner slot for the current identity (no-op if already
   *  owned by this identity; errors if a different key owns it). */
  claimOwner: () => Promise<void>;
  refetch: () => void;
}

export type DriveLoadingStage =
  | 'idle'
  | 'awaiting-auth'
  | 'resolving-namespaces'
  | 'resolving-registry-context'
  | 'loading-subgroups'
  | 'loading-folders'
  | 'syncing-from-peers'
  | 'ready';

/** Session-scoped set of namespace ids awaiting post-join sync.
 *  Exposed so JoinPage can stamp an id at accept time. */
export function markNamespaceJustJoined(namespaceId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const raw = sessionStorage.getItem(JUST_JOINED_KEY);
  const set = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  set.add(namespaceId);
  sessionStorage.setItem(JUST_JOINED_KEY, JSON.stringify([...set]));
}

function readJustJoinedSet(): Set<string> {
  if (typeof sessionStorage === 'undefined') return new Set();
  try {
    const raw = sessionStorage.getItem(JUST_JOINED_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function clearNamespaceJustJoined(namespaceId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const set = readJustJoinedSet();
  if (!set.delete(namespaceId)) return;
  sessionStorage.setItem(JUST_JOINED_KEY, JSON.stringify([...set]));
}

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
  /** Registry owner/managers — fetched once here, read by
   *  `useRegistryAdmin()` and `useFolderPermissions`. */
  registryAdmin: RegistryAdminSlice;

  // selected folder (UI-only; not persisted)
  selectedFolderId: string | null;
  setSelectedFolder: (id: string | null) => void;

  // status
  loading: boolean;
  stage: DriveLoadingStage;
  error: Error | null;
  refetch: () => Promise<void>;
}

// Internal implementation. A single instance of this runs at the
// Provider level, and every consumer reads the same state via
// useDriveWorkspace (see bottom of file). Multiple consumers calling
// the hook directly would each get independent `regFolders` /
// `selectedFolderId` state — so a refetch in one component's copy
// never reaches another's, and selection clicks never propagate.
function useDriveWorkspaceInternal(): DriveWorkspaceState {
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

  // Lazy-create fallback: if this namespace has no contexts at all
  // (e.g. created before the atomic createWorkspace change, or
  // createContext failed silently during create), seed the Registry
  // context here on first observation of the empty state. Without
  // this, `useGroupContexts(ns)` never returns anything and the UI
  // hangs on "Bootstrapping workspace…" forever.
  //
  // Guarded by a ref so Strict-Mode double-mount / re-renders don't
  // fire parallel create calls. The ref is keyed by namespaceId so a
  // subsequent (different) orphan namespace also gets its one shot.
  const lazyCreateRef = useRef<{ nsId: string; inFlight: boolean } | null>(null);
  useEffect(() => {
    if (!mero || !applicationId || !selectedNsId) return;
    if (contextsLoading) return;
    if (registryContextId) return;
    if (
      lazyCreateRef.current?.nsId === selectedNsId &&
      lazyCreateRef.current.inFlight
    ) {
      return;
    }
    lazyCreateRef.current = { nsId: selectedNsId, inFlight: true };
    const healingNsId = selectedNsId;
    (async () => {
      try {
        const reg = await mero.admin.createContext({
          applicationId,
          groupId: healingNsId,
          serviceName: REGISTRY_SERVICE_ID,
          initializationParams: [],
        });
        // Best-effort: claim the registry owner slot — but ONLY if the
        // caller is a core namespace-admin. `claim_owner` in the WASM
        // is first-come-first-served with NO authz gate (see
        // logic/crates/registry/src/permissions.rs::claim_owner_inner —
        // it sets the owner when unclaimed regardless of caller), so a
        // non-admin member opening a legacy/half-set-up workspace would
        // otherwise seize the registry. We mirror useMemberCaps's admin
        // check inline (we can't call useMemberCaps here — it consumes
        // this very hook's context, which isn't established yet).
        if (reg?.contextId && reg?.memberPublicKey) {
          let callerIsNsAdmin = false;
          try {
            const raw = (await mero.admin.listGroupMembers(
              healingNsId,
            )) as unknown as {
              members?: Array<{ identity: string; role?: string }>;
              data?: Array<{ identity: string; role?: string }>;
            };
            const membersList = raw.members ?? raw.data ?? [];
            const me = membersList.find(
              (m) => m.identity === reg.memberPublicKey,
            );
            callerIsNsAdmin = me?.role === 'Admin';
          } catch {
            // If we can't tell, err on the side of NOT claiming —
            // a real admin can claim later via the WorkspaceSettingsPanel
            // "Claim ownership" button.
            callerIsNsAdmin = false;
          }
          if (callerIsNsAdmin) {
            await new RegistryClient(
              mero,
              reg.contextId,
              reg.memberPublicKey,
            )
              .claimOwner()
              .catch(() => {});
          }
        }
        await refetchContexts();
      } catch (err) {
        // Non-fatal — surface via regError so the UI can show a
        // diagnostic instead of a perpetual spinner. Users can
        // retry by switching namespace or reloading.
        setRegError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (lazyCreateRef.current?.nsId === selectedNsId) {
          lazyCreateRef.current = { nsId: selectedNsId, inFlight: false };
        }
      }
    })();
  }, [
    mero,
    applicationId,
    selectedNsId,
    contextsLoading,
    registryContextId,
    refetchContexts,
  ]);

  // --- Registry client (memoized) ---
  const registryClient = useMemo<RegistryClient | null>(() => {
    if (!mero || !registryContextId || !selfIdentity) return null;
    return new RegistryClient(mero, registryContextId, selfIdentity);
  }, [mero, registryContextId, selfIdentity]);

  // --- Registry owner/managers (fetched ONCE here) ---
  // Was previously fetched per FolderContextMenu row via
  // `useRegistryAdmin()` → N×getOwner + N×listManagers for an N-folder
  // tree (all identical). Hoisted: fetch once, every consumer reads
  // `registryAdmin` off this state. `useRegistryAdmin()` still exists
  // (used by WorkspaceSettingsPanel) but now just returns this slice.
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
          setRegAdminError(e instanceof Error ? e : new Error(String(e)));
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
  const claimRegistryOwner = useCallback(async () => {
    if (!registryClient) return;
    await registryClient.claimOwner();
    setRegAdminTick((t) => t + 1);
  }, [registryClient]);

  const registryAdmin = useMemo<RegistryAdminSlice>(() => {
    const isOwner = !!regOwner && regOwner === selfIdentity;
    const isOwnerOrManager =
      isOwner || (!!selfIdentity && regManagers.includes(selfIdentity));
    return {
      owner: regOwner,
      managers: regManagers,
      isOwnerOrManager,
      isOwner,
      loading: regAdminLoading,
      error: regAdminError,
      addManager,
      removeManager,
      claimOwner: claimRegistryOwner,
      refetch: refetchRegAdmin,
    };
  }, [
    regOwner,
    regManagers,
    selfIdentity,
    regAdminLoading,
    regAdminError,
    addManager,
    removeManager,
    claimRegistryOwner,
    refetchRegAdmin,
  ]);

  // --- Subgroups (admin-side folder tree) ---
  const {
    subgroups,
    loading: subLoading,
    refetch: refetchSubgroups,
  } = useSubgroups(selectedNsId ?? undefined);

  // --- Registry-side folder metadata ---
  const [regFolders, setRegFolders] = useState<RegistryFolderShape[]>([]);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<Error | null>(null);

  // Extracted so `refetch()` can re-run it after mutations. Without
  // this, creating / renaming / deleting a folder mutates the registry
  // WASM but the local cache stays stale and the UI doesn't reflect
  // the change until the page is reloaded.
  const loadRegFolders = useCallback(async () => {
    if (!registryClient) {
      setRegFolders([]);
      setRegLoading(false);
      return;
    }
    setRegLoading(true);
    setRegError(null);
    try {
      const fs = await registryClient.getFolders();
      setRegFolders(
        fs.map((f) => ({
          id: f.id,
          parent_id: f.parent_id ?? null,
          color: f.color ?? null,
          alias: f.alias ?? null,
        })),
      );
    } catch (e: unknown) {
      setRegError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setRegLoading(false);
    }
  }, [registryClient]);

  useEffect(() => {
    let alive = true;
    void loadRegFolders().catch(() => {
      // errors are already captured into regError by loadRegFolders;
      // the alive guard is for the setState inside loadRegFolders,
      // but since we can't cancel the in-flight promise, we just
      // ignore stale rejections here.
      void alive;
    });
    return () => {
      alive = false;
    };
  }, [loadRegFolders]);

  // --- Alias lookup (per-folder getGroupInfo) ---
  //
  // `listSubgroups` is broken upstream (mero-js unwraps `.data` from a
  // response whose actual wire shape is `{subgroups: [...]}`) so we
  // can't read folder names from the subgroup list. `getGroupInfo`
  // IS correctly shaped (`{data: {..., metadata}}`) — unwrap works,
  // and the human-readable name lives at `metadata.name` per core
  // #2338. We fan out one getGroupInfo per folder and cache by id.
  //
  // `aliasRevision` bumps on refetch() so rename flows re-fetch even
  // though the folder id set hasn't changed.
  // Per-folder getGroupInfo also supplies subgroup_visibility (Open
  // / Restricted, per core PR #2261), since the registry no longer
  // stores it. Both the alias and visibility maps are populated from
  // the same fetch to keep it cheap.
  const [aliases, setAliases] = useState<Map<string, string>>(new Map());
  const [visibilities, setVisibilities] = useState<
    Map<string, 'Open' | 'Restricted'>
  >(new Map());
  const [aliasRevision, setAliasRevision] = useState(0);
  useEffect(() => {
    if (!mero) return;
    const ids = regFolders.map((f) => f.id);
    if (ids.length === 0) {
      setAliases(new Map());
      setVisibilities(new Map());
      return;
    }
    let alive = true;
    Promise.all(
      ids.map((id) =>
        mero.admin
          .getGroupInfo(id)
          .then(
            (info) =>
              [
                id,
                info?.metadata?.name ?? null,
                info?.subgroupVisibility ?? null,
              ] as const,
          )
          .catch(() => [id, null, null] as const),
      ),
    ).then((entries) => {
      if (!alive) return;
      const nextAliases = new Map<string, string>();
      const nextVis = new Map<string, 'Open' | 'Restricted'>();
      for (const [id, alias, vis] of entries) {
        if (alias) nextAliases.set(id, alias);
        if (vis === 'Open' || vis === 'Restricted') nextVis.set(id, vis);
      }
      setAliases(nextAliases);
      setVisibilities(nextVis);
    });
    return () => {
      alive = false;
    };
    // aliasRevision is intentional — bumping it forces this effect to
    // re-run after a rename even if regFolders is referentially stable.
  }, [mero, regFolders, aliasRevision]);

  // --- Merge admin subgroups with registry metadata ---
  // Registry is the source of truth for existence + tree shape;
  // aliases come from the per-folder getGroupInfo cache above. The
  // `subgroups` list (from mero-react) is unreliable upstream but
  // included as a secondary alias source when it happens to work.
  const folders = useMemo<MergedFolder[]>(() => {
    if (!rootGroupId) return [];
    const admin: AdminSubgroup[] = regFolders.map((f) => {
      const aliasFromCache = aliases.get(f.id);
      const nameFromSubgroups = (subgroups ?? []).find(
        (s) => s.groupId === f.id,
      )?.name;
      return {
        groupId: f.id,
        parent_id: f.parent_id,
        name: aliasFromCache ?? nameFromSubgroups,
      };
    });
    return mergeAdminAndRegistry(admin, regFolders, rootGroupId, visibilities)
      .folders;
  }, [rootGroupId, subgroups, regFolders, aliases, visibilities]);

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
          name: alias,
        });
        if (!ns?.namespaceId) {
          throw new Error('createNamespace returned no namespaceId');
        }
        // Step 2 — set the default capabilities every future member of
        // this namespace inherits on join: the "Editor" set (join open
        // folders + create folders + create document contexts). Per
        // design spec §5.2. Existing members are unaffected; an admin
        // can change this later via the Member-defaults panel.
        //
        // Best-effort: a failure here must NOT abort the create — the
        // namespace already exists, and leaving it unselected +
        // unconfigured is worse than just shipping it with core's
        // built-in default; the admin can re-set defaults via the
        // Member-defaults panel.
        try {
          await mero.admin.setDefaultCapabilities(ns.namespaceId, {
            defaultCapabilities: DEFAULT_NEW_MEMBER_CAPS,
          });
        } catch (e) {
          console.warn(
            '[useDriveWorkspace] setDefaultCapabilities failed during ' +
              'createWorkspace; namespace created without member defaults. ' +
              'Re-set via the Member-defaults panel.',
            e,
          );
        }
        // Step 3 — seed the Registry context inside the namespace's
        // root group. This is the convention the rest of the hook
        // relies on: contexts[0] === Registry context. Hard failure —
        // without a Registry context the workspace is unusable.
        const reg = await mero.admin.createContext({
          applicationId,
          groupId: ns.namespaceId,
          serviceName: REGISTRY_SERVICE_ID,
          initializationParams: [],
        });
        // Step 4 — claim the registry's owner slot for the creator.
        // The permissions layer is fail-closed (set_folder_role,
        // add_manager etc. all require owner/manager) until this runs,
        // so a freshly-created workspace would be unmanageable without
        // it. `createContext` returns `{ contextId, memberPublicKey }`
        // (see mero-js admin-types `CreateContextResponseData`).
        //
        // Best-effort: if this fails the registry is left unclaimed —
        // the admin can re-run claim via the WorkspaceSettingsPanel
        // "Claim ownership" button. We DON'T abort the create here;
        // see Fix D in the code-review notes.
        if (reg?.contextId && reg?.memberPublicKey) {
          try {
            await new RegistryClient(
              mero,
              reg.contextId,
              reg.memberPublicKey,
            ).claimOwner();
          } catch (e) {
            console.warn(
              '[useDriveWorkspace] claimOwner failed during ' +
                'createWorkspace; registry left unclaimed. Re-run via ' +
                'the workspace settings "Claim ownership" button.',
              e,
            );
          }
        }
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
    await Promise.all([
      refetchNamespaces(),
      refetchContexts(),
      refetchSubgroups(),
      loadRegFolders(),
    ]);
    refetchRegAdmin();
    // Force the per-folder getGroupInfo effect to re-run so a rename
    // surfaces in the tree even though the folder id set is unchanged.
    setAliasRevision((r) => r + 1);
  }, [
    refetchNamespaces,
    refetchContexts,
    refetchSubgroups,
    loadRegFolders,
    refetchRegAdmin,
  ]);

  // --- Post-join sync gate ---
  // If the active namespace was freshly joined in this session,
  // suppress the "uninitialised"-looking empty state and hold on a
  // `syncing-from-peers` stage until the Registry context resolves
  // AND we've read at least one folder list (even if empty). Without
  // this, a just-joined namespace shows raw empty state + the user
  // can't tell whether it's genuinely empty or still syncing.
  const [justJoinedTick, setJustJoinedTick] = useState(0);
  const justJoinedAt = useRef<Map<string, number>>(new Map());
  const [regFoldersLoadedForNs, setRegFoldersLoadedForNs] = useState<
    string | null
  >(null);
  // Track when the current namespace's regFolders load finishes
  // cleanly — that's the signal the sync gate should lift.
  useEffect(() => {
    if (!selectedNsId) return;
    if (regLoading) return;
    if (regError) return;
    setRegFoldersLoadedForNs(selectedNsId);
  }, [selectedNsId, regLoading, regError]);

  const isJustJoined = useMemo(() => {
    if (!selectedNsId) return false;
    const set = readJustJoinedSet();
    if (!set.has(selectedNsId)) return false;
    // Record first-seen time for watchdog purposes.
    if (!justJoinedAt.current.has(selectedNsId)) {
      justJoinedAt.current.set(selectedNsId, Date.now());
    }
    return true;
    // justJoinedTick is a bump-to-re-evaluate lever — used below when
    // the watchdog fires to flip us out of the gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNsId, justJoinedTick]);

  // Watchdog: expire the just-joined flag after JUST_JOINED_WATCHDOG_MS
  // so a stuck sync doesn't pin the UI on "Syncing…" forever.
  useEffect(() => {
    if (!selectedNsId || !isJustJoined) return;
    const firstSeen = justJoinedAt.current.get(selectedNsId) ?? Date.now();
    const remaining = JUST_JOINED_WATCHDOG_MS - (Date.now() - firstSeen);
    if (remaining <= 0) {
      clearNamespaceJustJoined(selectedNsId);
      setJustJoinedTick((t) => t + 1);
      return;
    }
    const t = setTimeout(() => {
      clearNamespaceJustJoined(selectedNsId);
      setJustJoinedTick((t) => t + 1);
    }, remaining);
    return () => clearTimeout(t);
  }, [selectedNsId, isJustJoined]);

  // Clear the flag once sync has landed — registry resolved AND we
  // successfully read the folder list for this namespace.
  useEffect(() => {
    if (!selectedNsId) return;
    if (!isJustJoined) return;
    if (!registryContextId) return;
    if (regFoldersLoadedForNs !== selectedNsId) return;
    clearNamespaceJustJoined(selectedNsId);
    setJustJoinedTick((t) => t + 1);
  }, [selectedNsId, isJustJoined, registryContextId, regFoldersLoadedForNs]);

  // --- Stage derivation for loading-indicator UX ---
  let stage: DriveLoadingStage = 'ready';
  if (authLoading) stage = 'awaiting-auth';
  else if (!isAuthenticated || !applicationId) stage = 'awaiting-auth';
  else if (nsLoading) stage = 'resolving-namespaces';
  else if (!selectedNsId) stage = 'idle';
  else if (contextsLoading || !registryContextId || membersLoading || !selfIdentity)
    stage = isJustJoined ? 'syncing-from-peers' : 'resolving-registry-context';
  else if (subLoading) stage = 'loading-subgroups';
  else if (regLoading) stage = 'loading-folders';
  else if (isJustJoined && regFoldersLoadedForNs !== selectedNsId)
    stage = 'syncing-from-peers';

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
    registryAdmin,

    selectedFolderId,
    setSelectedFolder,

    loading,
    stage,
    error,
    refetch,
  };
}

// --- Context / Provider / public hook ---

const DriveWorkspaceContext = createContext<DriveWorkspaceState | null>(null);

export function DriveWorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useDriveWorkspaceInternal();
  return createElement(
    DriveWorkspaceContext.Provider,
    { value },
    children,
  );
}

export function useDriveWorkspace(): DriveWorkspaceState {
  const ctx = useContext(DriveWorkspaceContext);
  if (!ctx) {
    throw new Error(
      'useDriveWorkspace must be used inside <DriveWorkspaceProvider>',
    );
  }
  return ctx;
}
