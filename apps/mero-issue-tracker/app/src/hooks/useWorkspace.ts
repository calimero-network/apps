/**
 * useWorkspace - the single owner of workspace resolution.
 *
 * Namespace/repo model:
 *  - A namespace is a team workspace. It is created or joined explicitly
 *    (no silent auto-create). `activeNs` is persisted in localStorage.
 *  - A context inside the namespace is ONE repo. Repos are added explicitly
 *    (name + GitHub URL); `activeRepo` (a contextId) is persisted per
 *    namespace and feeds every issue view.
 *  - Every human-readable NAME lives somewhere replicated, because a name only
 *    one node can read is worse than no name at all: the creator sees "Platform
 *    team" and everyone they invite sees `20150f8a`.
 *      * workspace name -> `createNamespace({name})` + the group metadata record
 *        it is served from, and `groupAlias` inside the invitation payload so
 *        `joinNamespace({groupName})` can record it at join time;
 *      * repo name      -> the context metadata record (`setContextMetadata`),
 *        not just `createContext({name})`, which is a label local to the node
 *        that created it;
 *      * people names   -> namespace member metadata (`setMemberMetadata`).
 *  - Desktop SSO: when the auth callback carries a contextId + identity, we
 *    treat that context as the active repo and resolve its namespace, skipping
 *    the pickers entirely.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMero,
  useNamespacesForApplication,
  useCreateNamespaceInvitation,
  useJoinNamespace,
  useGroupContexts,
  useGroupMembers,
  useNodeIdentity,
  useSetMemberMetadata,
  type Namespace,
} from '@calimero-network/mero-react';
import { useSubscription } from '@calimero-network/mero-react';
import { useStreamReconnect } from './useStreamReconnect';
import { PRIMARY_SERVICE } from '../config';
import { decodeInvitation } from '../utils/invitation';
import {
  buildInvitePayload,
  groupIdOfInvite,
  parseInvitePayload,
} from '../utils/invitePayload';
import { IssueTrackerClient } from '../generated/IssueTrackerClient';
import { useApplicationId } from './useApplicationId';
import { useMemberRoles, type UseMemberRolesReturn } from './useMemberRoles';
import { MEMBER_CAPABILITIES } from '../utils/roles';
import { buildAliasMap } from './useAliases';
import {
  readActiveNs,
  writeActiveNs,
  dropLegacyActiveNs,
  readActiveRepo,
  writeActiveRepo,
  clearPersistedWorkspace,
} from './workspacePersistence';
import { markNamespaceJustJoined, useJoinSync } from '@calimero-apps/join-sync';

export interface RepoEntry {
  contextId: string;
  /** Display name (context label) or a truncated id fallback. */
  name: string;
}

export interface UseWorkspaceReturn {
  /**
   * A workspace joined this session whose repos have not replicated yet. The
   * sidebar shows "syncing" instead of "No repos yet", which is otherwise what
   * a brand-new member reads about a workspace full of them.
   */
  isSyncing: boolean;
  dismissSyncing: () => void;

  applicationId: string | null;
  /** True while the node is still being asked which installed app this is. */
  resolvingApplicationId: boolean;

  // namespaces
  namespaces: Namespace[];
  activeNs: string | null;
  /** True while an SSO-callback context's namespace is being resolved (a
   *  desktop handoff in flight) - the caller should hold off on onboarding
   *  UI until this settles, to avoid a flash into the picker. */
  resolvingCallback: boolean;
  selectNamespace: (id: string) => void;
  createNamespace: (name: string) => Promise<string | null>;
  createNamespaceLoading: boolean;
  createNamespaceError: Error | null;
  join: (code: string) => Promise<void>;
  joinLoading: boolean;
  /** Mints an invitation and returns the JSON payload to wrap in a share link. */
  invite: () => Promise<string>;
  inviteLoading: boolean;

  // repos (contexts inside the active namespace)
  repos: RepoEntry[];
  activeRepo: string | null;
  selectRepo: (contextId: string) => void;
  addRepo: (name: string, repoUrl: string) => Promise<string | null>;
  addRepoLoading: boolean;
  addRepoError: Error | null;
  reposLoading: boolean;

  // people (namespace members) + identity
  contextId: string | null;
  executorPublicKey: string | null;
  selfIdentity: string | null;
  members: string[];
  memberNames: Map<string, string>;
  /** Namespace roles + capabilities, keyed by ACCOUNT. See utils/roles. */
  roles: UseMemberRolesReturn;
  membersLoading: boolean;
  membersLoaded: boolean;
  setMemberName: (name: string) => Promise<void>;
  refetchMembers: () => Promise<void>;

  // active repo metadata (shared state)
  repoUrl: string;
  setRepoUrl: (url: string) => Promise<void>;

  // status
  ready: boolean;
  loading: boolean;
  error: Error | null;
  clearPersisted: () => void;
}

export function useWorkspace(): UseWorkspaceReturn {
  const {
    mero,
    applicationId: authApplicationId,
    contextId: callbackContextId,
    contextIdentity: callbackContextIdentity,
  } = useMero();
  // Which installed application IS this app: asked of the node and matched by
  // the bundle's `package` (see utils/appId). The session's id and a baked
  // `VITE_APPLICATION_ID` both describe how you ARRIVED, and on a shared origin
  // the session's belongs to whichever mero app logged in last — every namespace
  // read is scoped by it, so the workspace switcher then lists the other app's
  // workspaces while looking like it ignores the filter.
  //
  // The session id remains as a fallback for the one case the node cannot
  // answer: this app is not installed there under its package (a raw-wasm dev
  // install). That is strictly the old behaviour, and only where the old
  // behaviour was all there was.
  const { appId: nodeApplicationId, resolving: resolvingApplicationId } = useApplicationId();
  // Null while the node is still answering, NOT the session id. Scoping the
  // namespace list to a possibly-wrong id for one render is how a stale pick
  // gets auto-selected and then persisted; `resolvingApplicationId` lets the
  // caller hold the onboarding pane back for that window instead.
  const applicationId = resolvingApplicationId
    ? null
    : nodeApplicationId || authApplicationId || null;

  const { namespaces, loading: nsLoading, refetch: refetchNamespaces } =
    useNamespacesForApplication(applicationId);
  const { createNamespaceInvitation, loading: inviteLoading } = useCreateNamespaceInvitation();
  const { joinNamespace, loading: joinLoading } = useJoinNamespace();
  const { setMemberMetadata } = useSetMemberMetadata();

  // Drop the pre-versioning key on load; it is never read for a value, only
  // ever explicit selections (below) populate the versioned one.
  useEffect(() => { dropLegacyActiveNs(); }, []);

  // --- Active namespace (persisted; SSO callback context resolves its own) ---
  const [activeNs, setActiveNs] = useState<string | null>(() => readActiveNs());
  // True while an SSO-callback context is present but its namespace hasn't
  // resolved yet - the caller holds off on the empty-state picker during this
  // window so it doesn't flash in right before the desktop handoff lands.
  const [resolvingCallback, setResolvingCallback] = useState(() => !!callbackContextId);
  const userSelectedNs = useRef(false);

  // Resolve the namespace of the SSO callback context (a context's group IS
  // its namespace) so the desktop path skips the picker, and set it directly
  // - a separate "apply the resolved id" effect would let resolvingCallback
  // clear a render before activeNs catches up, flashing the empty state.
  useEffect(() => {
    if (!callbackContextId) { setResolvingCallback(false); return; }
    if (!mero) { setResolvingCallback(true); return; }
    let cancelled = false;
    setResolvingCallback(true);
    (async () => {
      try {
        const gid = await mero.admin.getContextGroup(callbackContextId);
        if (!cancelled && gid) {
          // Explicit external handoff - persist it like any other selection.
          setActiveNs(gid);
          writeActiveNs(gid);
        }
      } catch {
        /* fall back to the discovered namespace list */
      } finally {
        if (!cancelled) setResolvingCallback(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mero, callbackContextId]);

  // Pick a workspace to show on load. A valid persisted/current selection wins;
  // otherwise default to the first namespace (the list is already scoped to this
  // app, so this is a friendly cold-start default, not a stale cross-app entry).
  // The default is in-memory only - explicit switcher picks are what persist.
  useEffect(() => {
    if (userSelectedNs.current || resolvingCallback) return;
    if (namespaces.length === 0) {
      if (activeNs) { setActiveNs(null); writeActiveNs(null); }
      return;
    }
    if (activeNs && namespaces.some((n) => n.namespaceId === activeNs)) return;
    if (activeNs) writeActiveNs(null); // drop a stale persisted id before defaulting
    setActiveNs(namespaces[0].namespaceId);
  }, [namespaces, activeNs, resolvingCallback]);

  const selectNamespace = useCallback((id: string) => {
    userSelectedNs.current = true;
    setActiveNs(id);
    writeActiveNs(id);
  }, []);

  // --- Contexts (repos) in the active namespace ---
  const { contexts, loading: reposLoading, refetch: refetchContexts } =
    useGroupContexts(activeNs);

  // Repo names, from the REPLICATED context metadata record.
  //
  // `createContext({name})` gives the context a label on the CREATOR's node.
  // `listGroupContexts` then reports it there and the creator sees "mero-core"
  // — but an invited member's node never received that label, so the same repo
  // rendered as `a1b2c3d4` for everyone else. `setContextMetadata` writes a CRDT
  // `MetadataRecord` against the managing group, which is the only place a name
  // written on one node is readable on another (this app ships the pattern as
  // `recipes/context-metadata`; `addRepo` now writes it).
  //
  // Keyed off the context IDS rather than the array, because `refetchContexts`
  // returns a fresh array on every poll and would otherwise re-fetch metadata
  // for every repo on every refetch.
  const contextIdsKey = useMemo(
    () => contexts.map((c) => c.contextId).join(','),
    [contexts],
  );
  const [repoMetaNames, setRepoMetaNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const ids = contextIdsKey ? contextIdsKey.split(',') : [];
    if (!mero || !activeNs || ids.length === 0) { setRepoMetaNames(new Map()); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (contextId) => {
          const rec = await mero.admin
            .getContextMetadata(activeNs, contextId)
            .catch(() => null);
          const name = rec?.name?.trim();
          return name ? ([contextId, name] as const) : null;
        }),
      );
      if (cancelled) return;
      setRepoMetaNames(new Map(entries.filter((e): e is [string, string] => e !== null)));
    })();
    return () => { cancelled = true; };
  }, [mero, activeNs, contextIdsKey]);

  const repos = useMemo<RepoEntry[]>(
    () =>
      contexts.map((c) => ({
        contextId: c.contextId,
        // Shared record first: the listing's `name` is this node's own label and
        // is absent on a node that did not create the context.
        name:
          repoMetaNames.get(c.contextId) ||
          c.name?.trim() ||
          c.contextId.slice(0, 8),
      })),
    [contexts, repoMetaNames],
  );

  // --- Active repo (a contextId; persisted per namespace) ---
  const [activeRepo, setActiveRepo] = useState<string | null>(callbackContextId);
  const userSelectedRepo = useRef(false);

  // On a namespace switch, drop the previous namespace's repo so a stale
  // contextId never leaks into the new namespace's views before its context
  // list resolves. The SSO path pins its own repo and is exempt.
  useEffect(() => {
    if (callbackContextId) return;
    userSelectedRepo.current = false;
    setActiveRepo(null);
  }, [activeNs, callbackContextId]);

  // Prefer the SSO callback context; otherwise auto-select the persisted repo
  // if it still exists, else the first repo, else none (add-repo empty state).
  useEffect(() => {
    if (callbackContextId) { setActiveRepo(callbackContextId); return; }
    if (!activeNs) { setActiveRepo(null); return; }
    if (userSelectedRepo.current && activeRepo && repos.some((r) => r.contextId === activeRepo)) {
      return;
    }
    const persisted = readActiveRepo(activeNs);
    if (persisted && repos.some((r) => r.contextId === persisted)) {
      setActiveRepo(persisted);
      return;
    }
    if (activeRepo && repos.some((r) => r.contextId === activeRepo)) return;
    setActiveRepo(repos[0]?.contextId ?? null);
  }, [callbackContextId, activeNs, repos, activeRepo]);

  const selectRepo = useCallback((contextId: string) => {
    userSelectedRepo.current = true;
    setActiveRepo(contextId);
    if (activeNs) writeActiveRepo(activeNs, contextId);
  }, [activeNs]);

  // --- Executor identity for the active repo context (for RPC) ---
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(
    callbackContextIdentity,
  );
  useEffect(() => {
    if (callbackContextId && callbackContextIdentity) {
      setExecutorPublicKey(callbackContextIdentity);
    }
  }, [callbackContextId, callbackContextIdentity]);

  useEffect(() => {
    if (!mero || !activeRepo) { setExecutorPublicKey(callbackContextIdentity); return; }
    if (activeRepo === callbackContextId && callbackContextIdentity) return;
    let cancelled = false;
    setExecutorPublicKey(null);
    (async () => {
      try {
        const { identities } = await mero.admin.getContextIdentitiesOwned(activeRepo);
        if (cancelled) return;
        if (identities.length > 0) { setExecutorPublicKey(identities[0]); return; }

        // No identity in this context yet. Auto-follow enrols a member in
        // contexts created AFTER they joined the namespace and in no others, so
        // every repo that already existed when someone accepted an invitation
        // lands here — and without an executor key `ready` never flips, which
        // read as "the invite worked but the app is stuck loading forever".
        // Joining is an explicit call; membership in the namespace is what
        // authorises it.
        const joined = await mero.admin.joinContext(activeRepo);
        if (!cancelled && joined?.memberPublicKey) {
          setExecutorPublicKey(joined.memberPublicKey);
        }
      } catch {
        /* leave null - useItems stays not-ready until an identity resolves */
      }
    })();
    return () => { cancelled = true; };
  }, [mero, activeRepo, callbackContextId, callbackContextIdentity]);

  // --- Namespace members (people names live here) ---
  const {
    members: nsMembers,
    loading: membersLoading,
    refetch: refetchMembers,
  } = useGroupMembers(activeNs);
  // mero-react 6 dropped `selfIdentity` from useGroupMembers: identity belongs
  // to the node, not to one group, so it moved to its own endpoint. Use
  // `accountId` - core rc.21 rekeyed group members from a signing PublicKey to
  // an AccountId, and it is what listGroupMembers keys entries by, so it is
  // what locates us in `nsMembers` and what member-addressing endpoints take.
  // Both ids are 32 bytes and neither the client nor the node rejects the
  // wrong one (it just names a principal that exists nowhere), so this has to
  // be the account and never `publicKey`.
  const { identity: nodeIdentity, refetch: refetchNodeIdentity } = useNodeIdentity();
  // useNodeIdentity takes no key, so it resolves once on mount - and on the
  // onboarding path the node has no account yet at that point, because it is
  // creating/joining the namespace that enrols it. Re-ask on every namespace
  // change or `selfIdentity` stays null for the whole first session, which
  // silently hides the set-your-name gate (AliasGate returns null without an
  // identity) and leaves every member lookup unresolved.
  const refetchNodeIdentityRef = useRef(refetchNodeIdentity);
  refetchNodeIdentityRef.current = refetchNodeIdentity;
  useEffect(() => { if (activeNs) void refetchNodeIdentityRef.current(); }, [activeNs]);
  const selfIdentity = nodeIdentity?.accountId ?? null;
  const [membersLoaded, setMembersLoaded] = useState(false);
  useEffect(() => {
    setMembersLoaded(false);
  }, [activeNs]);
  useEffect(() => {
    if (!membersLoading) setMembersLoaded(true);
  }, [membersLoading]);

  // Live member list: the node emits a GroupMembership event on the namespace
  // group id when someone joins/leaves, so refetch instead of making the user
  // reload. Group events carry `groupId` (context events carry `contextId`).
  useSubscription(
    { groupIds: activeNs ? [activeNs] : [] },
    (ev) => { if ('groupId' in ev && ev.groupId) void refetchMembers(); },
  );
  // A join or leave during a stream outage sends no event we will ever see.
  useStreamReconnect(() => { if (activeNs) void refetchMembers(); });

  const members = useMemo(() => nsMembers.map((m) => m.identity), [nsMembers]);
  const memberNames = useMemo(
    () => buildAliasMap(nsMembers.filter((m) => m.name).map((m) => ({ name: m.name as string, value: m.identity }))),
    [nsMembers],
  );

  // Roles + capabilities for this workspace. Keyed by ACCOUNT throughout —
  // `nsMembers[].identity` and `selfIdentity` are accounts; `executorPublicKey`
  // is a context executor key and is NOT interchangeable with them.
  const roles = useMemberRoles(activeNs, nsMembers, selfIdentity, refetchMembers);

  const setMemberName = useCallback(
    async (name: string) => {
      if (!activeNs || !selfIdentity) throw new Error('Workspace not ready');
      await setMemberMetadata(activeNs, selfIdentity, { name: name.trim(), data: {} });
      await refetchMembers();
    },
    [activeNs, selfIdentity, setMemberMetadata, refetchMembers],
  );

  // --- Active repo's shared repo_url ---
  const repoClient = useMemo(
    () =>
      mero && activeRepo && executorPublicKey
        ? new IssueTrackerClient(mero, activeRepo)
        : null,
    [mero, activeRepo, executorPublicKey],
  );
  const [repoUrl, setRepoUrlState] = useState('');
  useEffect(() => {
    if (!repoClient) { setRepoUrlState(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const info = await repoClient.getRepoInfo();
        if (!cancelled) setRepoUrlState(info?.repo_url ?? '');
      } catch {
        if (!cancelled) setRepoUrlState('');
      }
    })();
    return () => { cancelled = true; };
  }, [repoClient]);

  const setRepoUrl = useCallback(
    async (url: string) => {
      if (!repoClient) throw new Error('Workspace not ready');
      await repoClient.setRepoUrl({ url });
      setRepoUrlState(url);
    },
    [repoClient],
  );

  // --- Mutations: create namespace / add repo / join / invite ---
  const [createNamespaceLoading, setCreateNamespaceLoading] = useState(false);
  const [createNamespaceError, setCreateNamespaceError] = useState<Error | null>(null);
  const createNamespace = useCallback(
    async (name: string): Promise<string | null> => {
      if (!mero || !applicationId) return null;
      const trimmed = name.trim();
      if (!trimmed) {
        setCreateNamespaceError(new Error('Workspace name is required'));
        return null;
      }
      setCreateNamespaceLoading(true);
      setCreateNamespaceError(null);
      try {
        // No `upgradePolicy` here: core stopped accepting it on this endpoint
        // and mero-js 13 dropped it from CreateNamespaceRequest. Upgrades are
        // driven per-group now (useUpgradeGroup / useGroupUpgradeStatus), not
        // fixed at namespace creation.
        const ns = await mero.admin.createNamespace({
          applicationId,
          name: trimmed,
        });
        if (!ns?.namespaceId) throw new Error('createNamespace returned no namespaceId');
        // Pin the name into the group's metadata record as well as the create
        // call. `Namespace.name` is served FROM that record, so the two agree on
        // a node that honours `createNamespace({name})` — and on one that does
        // not, this is what stops the workspace from showing up as a hex id.
        // Best-effort; the create call's name already covers the common case.
        try {
          await mero.admin.setGroupMetadata(ns.namespaceId, { name: trimmed });
        } catch { /* createNamespace's own name stands */ }
        // What every member of this workspace may do: add a repo and invite
        // people (MEMBER_CAPABILITIES, defined once in utils/roles). This is the
        // DEFAULT, so it applies to members who join later, not retroactively.
        try {
          await mero.admin.setDefaultCapabilities(ns.namespaceId, {
            defaultCapabilities: MEMBER_CAPABILITIES,
          });
        } catch {
          // Keep core's built-in default. Swallowing this used to be invisible
          // and permanent: every member invited to the workspace could open it
          // and do nothing else, forever, with nothing anywhere saying why. The
          // members page now DETECTS that state and offers to repair it, which
          // is what makes this catch acceptable rather than a silent failure.
        }
        await refetchNamespaces();
        selectNamespace(ns.namespaceId);
        return ns.namespaceId;
      } catch (err) {
        setCreateNamespaceError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setCreateNamespaceLoading(false);
      }
    },
    [mero, applicationId, refetchNamespaces, selectNamespace],
  );

  const [addRepoLoading, setAddRepoLoading] = useState(false);
  const [addRepoError, setAddRepoError] = useState<Error | null>(null);
  const addRepo = useCallback(
    async (name: string, url: string): Promise<string | null> => {
      if (!mero || !applicationId || !activeNs) return null;
      const trimmedName = name.trim();
      const trimmedUrl = url.trim();
      if (!trimmedName) {
        setAddRepoError(new Error('Repo name is required'));
        return null;
      }
      setAddRepoLoading(true);
      setAddRepoError(null);
      try {
        const ctx = await mero.admin.createContext({
          applicationId,
          groupId: activeNs,
          serviceName: PRIMARY_SERVICE.name,
          initializationParams: [],
          name: trimmedName,
        });
        if (!ctx?.contextId) throw new Error('createContext returned no contextId');
        // Save the repo URL into shared state (hard-fail: it's the whole point).
        await new IssueTrackerClient(mero, ctx.contextId).setRepoUrl({
          url: trimmedUrl,
        });
        // Publish the name where every OTHER node can read it. `createContext`'s
        // `name` above is this node's label and travels nowhere; the context
        // metadata record is a CRDT against the managing group, so it reaches
        // everyone the namespace does. Without this an invited teammate sees
        // `a1b2c3d4` where the creator sees the repo's name.
        //
        // Best-effort: a nameless repo still works, and a metadata write is not
        // worth failing an otherwise-created repo over.
        try {
          await mero.admin.setContextMetadata(activeNs, ctx.contextId, { name: trimmedName });
        } catch { /* the local label above still names it here */ }
        // Best-effort node alias so tools can resolve the repo by name.
        try {
          await mero.admin.createContextAlias({ alias: trimmedName, contextId: ctx.contextId });
        } catch { /* convenience only */ }
        await refetchContexts();
        selectRepo(ctx.contextId);
        return ctx.contextId;
      } catch (err) {
        setAddRepoError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setAddRepoLoading(false);
      }
    },
    [mero, applicationId, activeNs, refetchContexts, selectRepo],
  );

  /**
   * Mint an invitation and return the JSON payload the share link carries.
   *
   * The payload is the ecosystem's shape — `{invitation, groupAlias, groupId,
   * kind}` — which is what mero-stream, mero-meet and mero-chat mint and parse,
   * so a code from any of them is readable here and vice versa. It used to be
   * the admin response `JSON.stringify`d verbatim, which was neither.
   *
   * `groupAlias` is the whole reason names cross nodes: `joinNamespace` takes a
   * `groupName` and there is nowhere else for the joiner's node to learn it from
   * at join time.
   */
  const invite = useCallback(async (): Promise<string> => {
    if (!activeNs) throw new Error('No workspace yet - create one first.');
    // Non-recursive: this app invites to the WORKSPACE, and the recursive form
    // returns a different envelope for no extra grant. Old recursive codes are
    // still decoded on the way in.
    const res = await createNamespaceInvitation(activeNs, {});
    const namespaceName =
      namespaces.find((n) => n.namespaceId === activeNs)?.name?.trim() || null;
    const payload = buildInvitePayload(res, { namespaceId: activeNs, namespaceName });
    if (!payload) {
      throw new Error('The node returned an invitation with no signature.');
    }
    return JSON.stringify(payload);
  }, [activeNs, namespaces, createNamespaceInvitation]);

  const join = useCallback(async (code: string) => {
    const payload = parseInvitePayload(decodeInvitation(code));
    if (!payload) throw new Error('That invite link could not be read.');

    // The id to act on comes from INSIDE the signed invitation, never from the
    // wrapper around it, so a tampered link cannot redirect a join. The wrapper's
    // `groupId` is only a fallback for a node that signs no group id.
    const nsId = groupIdOfInvite(payload) || payload.groupId || null;
    if (!nsId) throw new Error('Invalid invitation: cannot determine namespace.');

    // `groupName` is the creator's workspace name, riding along in the payload.
    // Passing it is what makes the joiner's sidebar say "Platform team" instead
    // of `20150f8a`.
    await joinNamespace(nsId, {
      invitation: payload.invitation as never,
      ...(payload.groupAlias ? { groupName: payload.groupAlias } : {}),
    });
    // Joined; this workspace's repos have not replicated yet. Flagged so the
    // sidebar says "syncing" rather than "No repos yet" — which is what a
    // joiner currently reads about a workspace full of them.
    markNamespaceJustJoined(nsId);
    await refetchNamespaces();
    selectNamespace(nsId);
    await refetchContexts();
  }, [joinNamespace, refetchNamespaces, refetchContexts, selectNamespace]);

  // `reposLoading` going false is the signal the repo list answered — for the
  // namespace that was active when it did, which is why the id is recorded
  // rather than just a boolean.
  const [listedForNs, setListedForNs] = useState<string | null>(null);
  useEffect(() => {
    if (!activeNs || reposLoading) return;
    setListedForNs(activeNs);
  }, [activeNs, reposLoading]);

  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId: activeNs,
    settled: listedForNs === activeNs,
  });

  const clearPersisted = useCallback(() => clearPersistedWorkspace(), []);

  return {
    isSyncing,
    dismissSyncing,
    applicationId,
    resolvingApplicationId,
    namespaces,
    activeNs,
    resolvingCallback,
    selectNamespace,
    createNamespace,
    createNamespaceLoading,
    createNamespaceError,
    join,
    joinLoading,
    invite,
    inviteLoading,
    repos,
    activeRepo,
    selectRepo,
    addRepo,
    addRepoLoading,
    addRepoError,
    reposLoading,
    contextId: activeRepo,
    executorPublicKey,
    selfIdentity,
    members,
    memberNames,
    roles,
    membersLoading,
    membersLoaded,
    setMemberName,
    refetchMembers,
    repoUrl,
    setRepoUrl,
    ready: activeRepo !== null && executorPublicKey !== null,
    loading: resolvingApplicationId || nsLoading || reposLoading,
    error: null,
    clearPersisted,
  };
}
