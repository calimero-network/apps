/**
 * useWorkspace - the single owner of workspace resolution.
 *
 * Namespace/repo model:
 *  - A namespace is a team workspace. It is created or joined explicitly
 *    (no silent auto-create). `activeNs` is persisted in localStorage.
 *  - A context inside the namespace is ONE repo. Repos are added explicitly
 *    (name + GitHub URL); `activeRepo` (a contextId) is persisted per
 *    namespace and feeds every issue view.
 *  - People names come from namespace member metadata (setMemberMetadata);
 *    repo names are the context label passed at createContext.
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
  useSetMemberMetadata,
  type Namespace,
} from '@calimero-network/mero-react';
import { PRIMARY_SERVICE } from '../config';
import { decodeInvitation } from '../utils/invitation';
import { IssueTrackerClient } from '../api/issue-tracker/IssueTrackerClient';
import { buildAliasMap } from './useAliases';

const ENV_APPLICATION_ID = import.meta.env.VITE_APPLICATION_ID?.trim() || null;

// Members can create per-namespace contexts + invite others. Mirrors core's
// MemberCapabilities bits (CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS).
const DEFAULT_CAPABILITIES = 1 | 2; // = 3

// Well-known context alias resolved by external tools (e.g. the MCP server).
// Points at the active repo's context.
const WORKSPACE_ALIAS = 'issue-tracker';

const ACTIVE_NS_KEY = 'issue-tracker:activeNs';
const activeRepoKey = (nsId: string) => `issue-tracker:activeRepo:${nsId}`;

export interface RepoEntry {
  contextId: string;
  /** Display name (context label) or a truncated id fallback. */
  name: string;
}

export interface UseWorkspaceReturn {
  applicationId: string | null;

  // namespaces
  namespaces: Namespace[];
  activeNs: string | null;
  selectNamespace: (id: string) => void;
  createNamespace: (name: string) => Promise<string | null>;
  createNamespaceLoading: boolean;
  createNamespaceError: Error | null;
  join: (code: string) => Promise<void>;
  joinLoading: boolean;
  invite: () => Promise<unknown>;
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

function readLs(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLs(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable - selection just isn't persisted */
  }
}

export function useWorkspace(): UseWorkspaceReturn {
  const {
    mero,
    applicationId: authApplicationId,
    contextId: callbackContextId,
    contextIdentity: callbackContextIdentity,
  } = useMero();
  const applicationId = authApplicationId || ENV_APPLICATION_ID;

  const { namespaces, loading: nsLoading, refetch: refetchNamespaces } =
    useNamespacesForApplication(applicationId);
  const { createNamespaceInvitation, loading: inviteLoading } = useCreateNamespaceInvitation();
  const { joinNamespace, loading: joinLoading } = useJoinNamespace();
  const { setMemberMetadata } = useSetMemberMetadata();

  // --- Active namespace (persisted; SSO callback context resolves its own) ---
  const [activeNs, setActiveNs] = useState<string | null>(() => readLs(ACTIVE_NS_KEY));
  const [nsFromCallback, setNsFromCallback] = useState<string | null>(null);
  const userSelectedNs = useRef(false);

  // Resolve the namespace of the SSO callback context (a context's group IS
  // its namespace) so the desktop path skips the picker.
  useEffect(() => {
    if (!mero || !callbackContextId) { setNsFromCallback(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const gid = await mero.admin.getContextGroup(callbackContextId);
        if (!cancelled && gid) setNsFromCallback(gid);
      } catch {
        /* fall back to the discovered namespace list */
      }
    })();
    return () => { cancelled = true; };
  }, [mero, callbackContextId]);

  // Auto-select: prefer the callback namespace, else a valid persisted one,
  // else the first discovered namespace. Never auto-create.
  useEffect(() => {
    if (nsFromCallback && nsFromCallback !== activeNs) {
      setActiveNs(nsFromCallback);
      return;
    }
    if (userSelectedNs.current) return;
    if (namespaces.length === 0) return;
    if (activeNs && namespaces.some((n) => n.namespaceId === activeNs)) return;
    setActiveNs(namespaces[0].namespaceId);
  }, [namespaces, nsFromCallback, activeNs]);

  useEffect(() => { writeLs(ACTIVE_NS_KEY, activeNs); }, [activeNs]);

  const selectNamespace = useCallback((id: string) => {
    userSelectedNs.current = true;
    setActiveNs(id);
  }, []);

  // --- Contexts (repos) in the active namespace ---
  const { contexts, loading: reposLoading, refetch: refetchContexts } =
    useGroupContexts(activeNs);
  const repos = useMemo<RepoEntry[]>(
    () => contexts.map((c) => ({ contextId: c.contextId, name: c.name?.trim() || c.contextId.slice(0, 8) })),
    [contexts],
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
    const persisted = readLs(activeRepoKey(activeNs));
    if (persisted && repos.some((r) => r.contextId === persisted)) {
      setActiveRepo(persisted);
      return;
    }
    if (activeRepo && repos.some((r) => r.contextId === activeRepo)) return;
    setActiveRepo(repos[0]?.contextId ?? null);
  }, [callbackContextId, activeNs, repos, activeRepo]);

  useEffect(() => {
    if (activeNs && activeRepo) writeLs(activeRepoKey(activeNs), activeRepo);
  }, [activeNs, activeRepo]);

  const selectRepo = useCallback((contextId: string) => {
    userSelectedRepo.current = true;
    setActiveRepo(contextId);
  }, []);

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
        if (!cancelled && identities.length > 0) setExecutorPublicKey(identities[0]);
      } catch {
        /* leave null - useItems stays not-ready until an identity resolves */
      }
    })();
    return () => { cancelled = true; };
  }, [mero, activeRepo, callbackContextId, callbackContextIdentity]);

  // --- Namespace members (people names live here) ---
  const {
    members: nsMembers,
    selfIdentity,
    loading: membersLoading,
    refetch: refetchMembers,
  } = useGroupMembers(activeNs);
  const [membersLoaded, setMembersLoaded] = useState(false);
  useEffect(() => {
    setMembersLoaded(false);
  }, [activeNs]);
  useEffect(() => {
    if (!membersLoading) setMembersLoaded(true);
  }, [membersLoading]);

  const members = useMemo(() => nsMembers.map((m) => m.identity), [nsMembers]);
  const memberNames = useMemo(
    () => buildAliasMap(nsMembers.filter((m) => m.name).map((m) => ({ name: m.name as string, value: m.identity }))),
    [nsMembers],
  );

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
        ? new IssueTrackerClient(mero, activeRepo, executorPublicKey)
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

  // Register the well-known `issue-tracker` context alias for the active repo,
  // so external tools can resolve it by name. Best-effort, one-shot per repo.
  const aliasEnsuredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mero || !activeRepo || aliasEnsuredRef.current === activeRepo) return;
    aliasEnsuredRef.current = activeRepo;
    (async () => {
      try {
        const looked = await mero.admin.lookupContextAlias(WORKSPACE_ALIAS);
        if (looked?.value) return;
        await mero.admin.createContextAlias({ alias: WORKSPACE_ALIAS, contextId: activeRepo });
      } catch {
        try {
          await mero.admin.createContextAlias({ alias: WORKSPACE_ALIAS, contextId: activeRepo });
        } catch {
          /* alias is a convenience only - never blocks the workspace */
        }
      }
    })();
  }, [mero, activeRepo]);

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
        const ns = await mero.admin.createNamespace({
          applicationId,
          upgradePolicy: 'Automatic',
          name: trimmed,
        });
        if (!ns?.namespaceId) throw new Error('createNamespace returned no namespaceId');
        // Best-effort: the namespace is usable without it; an admin can re-set.
        try {
          await mero.admin.setDefaultCapabilities(ns.namespaceId, {
            defaultCapabilities: DEFAULT_CAPABILITIES,
          });
        } catch { /* keep core's built-in default */ }
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
        await new IssueTrackerClient(mero, ctx.contextId, ctx.memberPublicKey).setRepoUrl({
          url: trimmedUrl,
        });
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

  const invite = useCallback(async () => {
    if (!activeNs) throw new Error('No workspace yet - create one first.');
    return createNamespaceInvitation(activeNs, { recursive: true });
  }, [activeNs, createNamespaceInvitation]);

  const join = useCallback(async (code: string) => {
    const parsed = decodeInvitation(code) as any;

    // Share codes wrap the raw namespace invitation; unwrap to {nsId, invitation}.
    let nsId: string | null = null;
    let invitation = parsed;
    let groupName: string | undefined;
    if (Array.isArray(parsed?.invitations) && parsed.invitations.length > 0) {
      const first = parsed.invitations[0];
      nsId = first.groupId;
      invitation = first.invitation;
      groupName = first.groupAlias || undefined;
    } else if (parsed?.invitation?.groupId) {
      const gid = parsed.invitation.groupId;
      nsId = Array.isArray(gid)
        ? gid.map((b: number) => b.toString(16).padStart(2, '0')).join('')
        : String(gid);
      groupName = parsed.groupAlias || undefined;
    }
    if (!nsId) throw new Error('Invalid invitation: cannot determine namespace.');

    await joinNamespace(nsId, { invitation, groupName });
    await refetchNamespaces();
    selectNamespace(nsId);
    await refetchContexts();
  }, [joinNamespace, refetchNamespaces, refetchContexts, selectNamespace]);

  const clearPersisted = useCallback(() => {
    writeLs(ACTIVE_NS_KEY, null);
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('issue-tracker:activeRepo:') || k.startsWith('issue-tracker:alias-set:'))) {
          localStorage.removeItem(k);
        }
      }
    } catch { /* storage unavailable */ }
  }, []);

  return {
    applicationId,
    namespaces,
    activeNs,
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
    membersLoading,
    membersLoaded,
    setMemberName,
    refetchMembers,
    repoUrl,
    setRepoUrl,
    ready: activeRepo !== null && executorPublicKey !== null,
    loading: nsLoading || reposLoading,
    error: null,
    clearPersisted,
  };
}
