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
import { useContextEvents } from './useContextEvents';
import { useSyncStatus, type SyncSnapshot } from './useSyncStatus';
import { useLocalStorage } from './useLocalStorage';
import { useNamespaceDisplayNames } from './useNamespaceDisplayNames';
import {
  mergeAdminAndRegistry,
  type AdminSubgroup,
  type MergedFolder,
  type RegistryFolderShape,
} from './useWorkspaceTree';
import {
  DEFAULT_NEW_MEMBER_CAPS,
  ENV_APPLICATION_ID,
  MAX_ALIAS_LENGTH,
  REGISTRY_SERVICE_ID,
} from '@/constants/config';
import { isAccessDeniedError } from '@/utils/accessDenied';

/** Persisted-namespace localStorage key. Exported so other call sites
 *  (e.g. WorkspacePage's logout cleanup) can clear the same key without
 *  hardcoding the string and drifting from this hook's reader. */
export const ACTIVE_NS_KEY = 'mero-drive:activeNs';
// SessionStorage-only so it doesn't persist across tabs or reloads
// once sync settles. Set by JoinPage on successful joinNamespace /
// joinGroup; the first time the namespace reaches a ready state in
// useDriveWorkspace, the flag is cleared and we stop gating.
const JUST_JOINED_KEY = 'mero-drive:justJoined';
// Base window for the syncing gate. The governance op + registry state
// typically land in <1s on a healthy mesh; past this window we give up
// ONLY if no sync is actively in flight (see the watchdog effect).
const JUST_JOINED_WATCHDOG_MS = 30_000;
// Hard ceiling: bound a genuinely stuck sync so the gate can never pin
// the UI forever, even while a sync keeps reporting activity.
const JUST_JOINED_MAX_MS = 120_000;
// How often the watchdog re-checks live sync activity past the base window.
const WATCHDOG_POLL_MS = 2_000;

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
  /** Identity → display name for members of the currently-selected
   *  namespace. Populated from the namespace's root-group GroupMember
   *  rows (server-reported `m.name`). MemberLabel reads this so
   *  folder/sharing panels show namespace-set display names without
   *  firing one getMemberMetadata HTTP call per row. Empty object
   *  when no namespace is selected or the metadata hasn't loaded. */
  namespaceMemberNames: Record<string, string>;

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
  /** The COMPLETE folder tree shape (id + parent_id) straight from the
   *  registry — NOT filtered by visibility like `folders`. Use this for
   *  structural operations that must see hidden/unresolved folders too,
   *  e.g. depth-cap checks: filtering would drop a hidden ancestor and
   *  undercount depth. (Deletion reads the tree directly from the
   *  registry for the same reason.) */
  allFolderNodes: { id: string; parent_id: string | null }[];
  /** Registry owner/managers — fetched once here, read by
   *  `useRegistryAdmin()` and `useFolderPermissions`. */
  registryAdmin: RegistryAdminSlice;

  // selected folder (UI-only; not persisted)
  selectedFolderId: string | null;
  setSelectedFolder: (id: string | null) => void;

  // status
  loading: boolean;
  stage: DriveLoadingStage;
  /** Live sync-status of the active namespace / registry context, read off
   *  SSE. Non-null while a sync is (or recently was) in flight; the join
   *  UI reads it to show real progress during `stage === 'syncing-from-peers'`. */
  syncStatus: SyncSnapshot | null;
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
    namespaces: rawNamespaces,
    loading: nsLoading,
    error: nsError,
    refetch: refetchNamespaces,
  } = useNamespacesForApplication(applicationId ?? undefined);

  // `listNamespacesForApplication` omits a namespace's `name` until the
  // node has synced its root-group metadata — which lags a join by a
  // few seconds. Backfill it by polling `getGroupMetadata`, so the
  // workspace switcher shows the real name instead of the raw id.
  const namespaces = useNamespaceDisplayNames(rawNamespaces);

  const [selectedNsId, setSelectedNsId] = useLocalStorage<string | null>(
    ACTIVE_NS_KEY,
    null,
  );

  // Auto-select a namespace when the list lands and we don't have a
  // valid selection. Fall back to [0] if the persisted id isn't in
  // the list (deleted remotely, user cleared storage, etc.).
  //
  // Edge case (load-bearing for the post-/join flow): if the user just
  // joined a namespace via JoinPage, the just-joined set in
  // sessionStorage has its id. Server-side memberships outlive
  // browser-context lifetimes (Playwright fresh contexts inherit a
  // node that already knows the user from prior tests), so on first
  // render `namespaces` already contains a half-dozen unrelated ids
  // and the persisted activeNs might still be valid from a previous
  // session. Prefer a just-joined id over both, so the user lands on
  // the namespace they just accepted instead of an arbitrary survivor.
  const userCleared = useRef(false);
  useEffect(() => {
    if (namespaces.length === 0) return;
    if (userCleared.current) return;
    const justJoined = readJustJoinedSet();
    if (justJoined.size > 0) {
      const target = namespaces.find((n) => justJoined.has(n.namespaceId));
      if (target && target.namespaceId !== selectedNsId) {
        setSelectedNsId(target.namespaceId);
        return;
      }
    }
    if (selectedNsId && namespaces.some((n) => n.namespaceId === selectedNsId)) {
      return;
    }
    setSelectedNsId(namespaces[0].namespaceId);
  }, [namespaces, selectedNsId, setSelectedNsId]);

  const rootGroupId = selectedNsId;

  // --- Per-namespace identity via mero-react's primitive ---
  const {
    selfIdentity,
    members: nsMembers,
    loading: membersLoading,
    refetch: refetchNsMembers,
  } = useGroupMembers(selectedNsId ?? undefined);

  // Identity → server-reported display name map for THIS namespace.
  // Sourced from the namespace's root-group member rows, where
  // setMemberMetadata(namespaceId, identity, {name}) lands. Exposed
  // so MemberLabel — and any other surface that renders an arbitrary
  // identity within the namespace context — can show the user's
  // chosen name instead of a truncated pubkey, without each render
  // site firing its own getMemberMetadata round-trip.
  //
  // Subgroup (folder) member rows can also lift names from this map:
  // an admin types a namespace identity into the folder's "Add
  // member" input, so the identity stored on the folder GroupMember
  // row matches the namespace-level identity. The subgroup's own
  // GroupMember.name is independent metadata and is usually unset
  // (users only edit their name in namespace settings, which writes
  // to the namespace group), which is why the folder sharing panel
  // previously showed raw pubkey truncations.
  const namespaceMemberNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of nsMembers) {
      if (m.name) out[m.identity] = m.name;
    }
    return out;
  }, [nsMembers]);

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
    // The admin-membership check below needs the caller's verified
    // namespace identity. Wait for it. Without this guard, `selfIdentity`
    // could be `null` and the check would silently fall through to
    // "not admin" (callerIsNsAdmin = false), leaving a legitimate
    // admin's registry unclaimed.
    if (!selfIdentity) return;
    if (
      lazyCreateRef.current?.nsId === selectedNsId &&
      lazyCreateRef.current.inFlight
    ) {
      return;
    }
    lazyCreateRef.current = { nsId: selectedNsId, inFlight: true };
    const healingNsId = selectedNsId;
    const callerIdentity = selfIdentity;
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
        //
        // Identity sourcing: use `callerIdentity` (a copy of
        // `selfIdentity` from useGroupMembers) for the membership
        // probe rather than the new context's `reg.memberPublicKey`.
        // The two agree in the common single-identity case, but
        // namespaces with multiple owned identities can have
        // `createContext` mint or pick a different one than the
        // identity that ranks as Admin in the namespace.
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
              (m) => m.identity === callerIdentity,
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
    selfIdentity,
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
  // Bumped per call so a slow response can't land after a newer one.
  // Without it, switching namespaces mid-flight lets the old namespace's
  // folders populate under the new one, from where they feed the
  // getGroupInfo fan-out and useFolderOperations' delete cascade.
  const regSeqRef = useRef(0);

  const loadRegFolders = useCallback(async () => {
    const seq = ++regSeqRef.current;
    const stale = () => regSeqRef.current !== seq;
    if (!registryClient) {
      setRegFolders([]);
      setRegLoading(false);
      return;
    }
    setRegLoading(true);
    setRegError(null);
    try {
      const fs = await registryClient.getFolders();
      if (stale()) return;
      const mapped = fs.map((f) => ({
        id: f.id,
        parent_id: f.parent_id ?? null,
        color: f.color ?? null,
        alias: f.alias ?? null,
      }));
      // Keep the previous array identity when the fetched content is
      // byte-identical, so the `folders`/`allFolderNodes` memos (and the
      // whole folder tree) don't get a fresh identity on every refetch.
      // JSON compare is fine for these small flat rows; if the folder set
      // grows large, switch to a shallow per-field compare.
      setRegFolders((prev) =>
        JSON.stringify(prev) === JSON.stringify(mapped) ? prev : mapped,
      );
    } catch (e: unknown) {
      if (stale()) return;
      setRegError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (!stale()) setRegLoading(false);
    }
  }, [registryClient]);

  useEffect(() => {
    // Cancellation is handled by regSeqRef inside loadRegFolders: the next
    // call bumps the sequence, so this one's writes are dropped.
    void loadRegFolders();
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
  // Folders the caller may NOT see — their getGroupInfo came back
  // "not a member" (core rejects non-members of restricted subgroups,
  // crates/context/.../get_group_info.rs). These are filtered out of
  // the rail. A folder leaves this set automatically once the caller
  // is added: the SSE-driven refetch re-runs this fan-out and the
  // getGroupInfo then succeeds. Only a *definitive* access-denied
  // hides a folder; transient (5xx/network) errors keep it visible.
  const [hiddenFolderIds, setHiddenFolderIds] = useState<Set<string>>(
    new Set(),
  );
  // Folders whose access has been *resolved* by the fan-out below
  // (getGroupInfo settled — success, access-denied, or transient).
  // The folder list is gated on this so a restricted folder the caller
  // can't see never flashes in the rail during the async window before
  // hiddenFolderIds is populated (the fan-out is NOT part of the
  // `loading`/`stage` derivation, so without this gate the rail renders
  // with a stale/empty hidden set on initial load + namespace switch).
  const [resolvedFolderIds, setResolvedFolderIds] = useState<Set<string>>(
    new Set(),
  );
  // Always-current namespace, read inside the fan-out's async tail. The
  // fan-out effect doesn't depend on selectedNsId, so on a namespace
  // switch an in-flight fan-out from the OLD namespace could resolve
  // *after* the clear effect below runs and repopulate resolvedFolderIds
  // with stale ids. Comparing the namespace captured at fan-out start
  // against this ref lets us drop such a stale resolution.
  const selectedNsIdRef = useRef(selectedNsId);
  selectedNsIdRef.current = selectedNsId;
  const [aliasRevision, setAliasRevision] = useState(0);
  useEffect(() => {
    if (!mero) return;
    const ids = regFolders.map((f) => f.id);
    // Capture via the ref (not a direct `selectedNsId` read) so this
    // stays out of the dependency array — the effect intentionally
    // re-runs on regFolders/aliasRevision, not on namespace.
    const nsAtStart = selectedNsIdRef.current;
    if (ids.length === 0) {
      setAliases(new Map());
      setVisibilities(new Map());
      setHiddenFolderIds(new Set());
      setResolvedFolderIds(new Set());
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
                false, // not access-denied
              ] as const,
          )
          .catch((e) => [id, null, null, isAccessDeniedError(e)] as const),
      ),
    ).then((entries) => {
      // Drop the result if this effect was torn down, OR if the active
      // namespace changed while the fan-out was in flight — otherwise a
      // stale old-namespace batch would repopulate resolvedFolderIds
      // after the namespace-switch clear effect.
      if (!alive || selectedNsIdRef.current !== nsAtStart) return;
      const nextAliases = new Map<string, string>();
      const nextVis = new Map<string, 'Open' | 'Restricted'>();
      const nextHidden = new Set<string>();
      for (const [id, alias, vis, denied] of entries) {
        if (denied) nextHidden.add(id);
        if (alias) nextAliases.set(id, alias);
        // Server returns lowercase ("open" / "restricted") per core
        // PR #2261; accept both casings so the toggle's optimistic
        // uppercase write also lands cleanly.
        const norm =
          vis === 'Open' || vis === 'open'
            ? 'Open'
            : vis === 'Restricted' || vis === 'restricted'
              ? 'Restricted'
              : null;
        if (norm) nextVis.set(id, norm);
      }
      setAliases(nextAliases);
      setVisibilities(nextVis);
      setHiddenFolderIds(nextHidden);
      // Mark every folder in this batch resolved. Updated atomically on
      // completion so a re-fan (e.g. SSE refetch with the same ids)
      // keeps the previous resolved set applied meanwhile — no flicker.
      setResolvedFolderIds(new Set(ids));
    });
    return () => {
      alive = false;
    };
    // aliasRevision is intentional — bumping it forces this effect to
    // re-run after a rename even if regFolders is referentially stable.
  }, [mero, regFolders, aliasRevision]);

  // Re-arm the first-paint gate on namespace switch: clear the resolved
  // set so the new workspace's folders aren't rendered (with a stale
  // hidden set) before their access is known. Keyed on selectedNsId
  // ONLY — a same-namespace SSE refetch must not reset this, or the rail
  // would blank on every event.
  useEffect(() => {
    setResolvedFolderIds(new Set());
  }, [selectedNsId]);

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
    return mergeAdminAndRegistry(
      admin,
      regFolders,
      rootGroupId,
      visibilities,
      hiddenFolderIds,
      // Gate: only surface folders whose access the fan-out has
      // resolved, so a restricted folder never flashes before
      // hiddenFolderIds is known. Already-resolved folders persist in
      // resolvedFolderIds across re-fans, so when a new folder arrives
      // only that folder is withheld until it resolves — the existing
      // rows keep rendering, never blanked.
    ).folders.filter((f) => resolvedFolderIds.has(f.id));
  }, [
    rootGroupId,
    subgroups,
    regFolders,
    aliases,
    visibilities,
    hiddenFolderIds,
    resolvedFolderIds,
  ]);

  // Complete, UNFILTERED tree shape (id + parent_id) for structural
  // operations that must account for hidden/unresolved folders — e.g.
  // the new-folder depth cap, which would undercount through a hidden
  // ancestor if it used the filtered `folders` above.
  const allFolderNodes = useMemo(
    () => regFolders.map((f) => ({ id: f.id, parent_id: f.parent_id })),
    [regFolders],
  );

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
      // Defensive validation: NamespaceCreateDialog already trims +
      // length-checks before calling, but `createWorkspace` is a
      // public hook API and other callers (programmatic, tests)
      // would otherwise hit a generic admin-api error here. Keep the
      // contract local to this function.
      // Validation failures return `null` (not throw) to honor the
      // documented `Promise<string | null>` contract — null = failure,
      // with the reason exposed via `createWorkspaceError`. The sole
      // caller (`NamespaceCreateDialog`) awaits without a try/catch and
      // branches on the null; a throw here would surface as an
      // unhandled rejection instead.
      const trimmed = alias.trim();
      if (!trimmed) {
        setCreateError(new Error('Workspace name is required'));
        return null;
      }
      if (trimmed.length > MAX_ALIAS_LENGTH) {
        setCreateError(
          new Error(
            `Workspace name must be ${MAX_ALIAS_LENGTH} characters or fewer`,
          ),
        );
        return null;
      }
      setCreateLoading(true);
      setCreateError(null);
      try {
        // Step 1 — create the namespace (root group).
        const ns = await mero.admin.createNamespace({
          applicationId,
          upgradePolicy: 'Automatic',
          name: trimmed,
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
      refetchNsMembers(),
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
    refetchNsMembers,
    loadRegFolders,
    refetchRegAdmin,
  ]);

  // Live-refresh on remote workspace mutations. Subscribing to the
  // active namespace + registry context covers:
  //   - new subgroups / folder renames / re-parents / visibility flips
  //     (namespace op-DAG events)
  //   - registry folder metadata changes — colors, parent_id, alias
  //     mirror (registry context events)
  //   - namespace member adds/removes/role changes (namespace events)
  // The full refetch() above is cheap relative to the user-visible
  // win; if event volume becomes a problem we can debounce here.
  //
  // Handler captured in a stable useCallback so a render of this
  // hook doesn't churn the SSE subscription. `refetch` itself is a
  // stable useCallback over its constituent refetches, so the
  // handler's identity only changes when one of them does.
  const onWorkspaceEvent = useCallback(() => {
    void refetch();
  }, [refetch]);
  // `strict`: only refetch the workspace for mutations of the contexts
  // it actually owns — the namespace + the registry. Folder structure
  // (create / color / role) writes the registry, so those still ding
  // here. What this filters OUT is docs-context mutations: editing a
  // doc fires rapid state-DAG events on that folder's docs context, and
  // without this every autosave triggered a full workspace refetch +
  // a getGroupInfo fan-out over every folder (500-ing on the restricted
  // ones the caller can't read). The workspace never needs doc-content
  // events, and being added to a folder is governance (never an SSE
  // ding anyway), so filtering these doesn't change the un-hide path.
  useContextEvents([selectedNsId, registryContextId], onWorkspaceEvent, {
    strict: true,
    // Coalesce event bursts into one refetch: a settled batch of registry
    // ops (or a sync tick fan-out) rebuilds the folder tree once, not per
    // event. 300ms is imperceptible for structure changes but collapses the
    // churn that was rebuilding the sidebar on every SyncStatus tick.
    debounceMs: 300,
  });

  // Live sync-status off the SAME SSE stream (shared socket, extra handler).
  // Lets the post-join UI show real progress and lets the watchdog below
  // tell "still discovering peers / streaming snapshot" from "genuinely
  // stuck" instead of blindly timing out.
  const syncStatus = useSyncStatus([selectedNsId, registryContextId]);
  // Ref so the watchdog tick reads the latest snapshot without listing
  // syncStatus as an effect dep (which would restart the timer every event).
  const syncStatusRef = useRef<SyncSnapshot | null>(null);
  syncStatusRef.current = syncStatus;

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

  // Watchdog: past the base window, drop the gate ONLY if no sync is
  // actively in flight — a cold cross-network join legitimately exceeds
  // 30s (the peer-discovery floor alone is 30-60s), and a large snapshot
  // streams for a while, both of which keep reporting SSE activity. We
  // read live activity from a ref (no effect re-run per event) and poll
  // it every WATCHDOG_POLL_MS. JUST_JOINED_MAX_MS is the hard ceiling so
  // a genuinely stuck sync can never pin the UI forever.
  useEffect(() => {
    if (!selectedNsId || !isJustJoined) return;
    const firstSeen = justJoinedAt.current.get(selectedNsId) ?? Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const elapsed = Date.now() - firstSeen;
      // Active = a sync making forward progress (discovering peers /
      // streaming). `backingOff` is the stuck signal — the UI shows Retry
      // for it — so it counts as inactive: no reason to hold the gate to the
      // 120s cap when the sync is failing and the user can act. `idle` (or
      // no event yet) is also inactive.
      const snap = syncStatusRef.current;
      const active =
        !!snap && snap.phase !== 'idle' && snap.phase !== 'backingOff';
      const giveUp =
        elapsed >= JUST_JOINED_MAX_MS ||
        (elapsed >= JUST_JOINED_WATCHDOG_MS && !active);
      if (giveUp) {
        clearNamespaceJustJoined(selectedNsId);
        setJustJoinedTick((t) => t + 1);
        return;
      }
      timer = setTimeout(tick, WATCHDOG_POLL_MS);
    };
    timer = setTimeout(tick, JUST_JOINED_WATCHDOG_MS);
    return () => clearTimeout(timer);
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

  // First-paint gate: we have folders to show but NONE have been
  // resolved by the getGroupInfo fan-out yet. Keep the rail in
  // "Loading folders…" rather than rendering an empty (and potentially
  // leaky) list. This fires only on the *initial* paint of a folder set
  // — on first load and on namespace switch (the effect above clears
  // resolvedFolderIds keyed on selectedNsId). It does NOT fire when a
  // single new folder arrives mid-session: resolvedFolderIds is already
  // non-empty then, so the memo's `.filter` keeps the existing rows
  // visible while only the new folder is withheld until it resolves.
  const awaitingFirstFolderResolve =
    regFolders.length > 0 && resolvedFolderIds.size === 0;

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
  else if (awaitingFirstFolderResolve) stage = 'loading-folders';
  else if (isJustJoined && regFoldersLoadedForNs !== selectedNsId)
    stage = 'syncing-from-peers';

  const loading = stage !== 'ready' && stage !== 'idle';
  const error = nsError ?? regError ?? null;

  return useMemo<DriveWorkspaceState>(
    () => ({
      applicationId,
      selfIdentity: selfIdentity ?? contextIdentity ?? null,
      namespaceMemberNames,

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
      allFolderNodes,
      registryAdmin,

      selectedFolderId,
      setSelectedFolder,

      loading,
      stage,
      syncStatus,
      error,
      refetch,
    }),
    [
      applicationId,
      selfIdentity,
      contextIdentity,
      namespaceMemberNames,
      namespaces,
      selectedNsId,
      rootGroupId,
      selectNamespace,
      clearNamespace,
      createWorkspace,
      createLoading,
      createError,
      registryContextId,
      registryClient,
      folders,
      allFolderNodes,
      registryAdmin,
      selectedFolderId,
      setSelectedFolder,
      loading,
      stage,
      syncStatus,
      error,
      refetch,
    ],
  );
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
