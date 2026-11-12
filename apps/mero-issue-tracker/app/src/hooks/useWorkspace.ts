/**
 * The active workspace (an org) and repository (an app instance in it), the
 * people in the workspace, and the active repo's URL.
 *
 * v1 resolved these from a node: the installed application, its namespaces,
 * their contexts, group members and aliases, kept live by the node's sync
 * stream. On Calimero 1.0 the account's orgs come from `/me`, a workspace's
 * repos from `listApps` (this app's bundle in dev, its package in production)
 * filtered by org, and members and their names from `getOrg`. Nothing has to
 * replicate before it shows, so v1's "syncing" and "warming up" states are gone;
 * org-level changes (a new repo, a new member) are re-read when the window
 * regains focus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError, otherOrgs, type OtherOrg } from '@calimero-apps/connect';
import { setOrgName } from '@calimero-apps/names';
import { useInstanceRelease } from '@calimero-apps/passkey';

import { useSignedIn } from '../sessionContext';
import { MeroIssueTrackerClient } from '../generated/client';
import { toRepoInfo } from '../tracker';
import {
  addRepo as addRepoTo,
  createWorkspace,
  inviteLink,
  inviteToken,
  leaveWorkspace,
  leaveWorkspaceOrg,
  listRepos,
  listWorkspaces,
  readMembers,
  type OrgMembers,
  type RepoEntry,
  type Workspace,
} from '../workspaces';
import { useMemberRoles, type UseMemberRolesReturn } from './useMemberRoles';
import {
  JOINED_EVENT,
  readActiveNs,
  readActiveRepo,
  writeActiveNs,
  writeActiveRepo,
} from './workspacePersistence';

export type { RepoEntry, Workspace };

export interface CreateWorkspaceResult {
  /** The new workspace, or null when creation failed (`createNamespaceError` says why). */
  namespaceId: string | null;
  /** Set when the workspace exists but its member defaults could not be set. */
  warning: string | null;
}

export interface UseWorkspaceReturn {
  /** The account's other orgs, where this app may be added ("Connect to an existing organization"). */
  loadOtherOrgs: () => Promise<OtherOrg[]>;
  /** Adds this app (a first instance) to `org` and selects it. Throws on failure. */
  connectOrg: (org: OtherOrg) => Promise<void>;
  /** The workspace list has not answered yet: an empty list is not "no workspaces". */
  namespacesPending: boolean;
  /** The workspace list failed: an empty list is not "no workspaces" either. */
  namespacesFailed: boolean;
  retryNamespaces: () => void;

  namespaces: Workspace[];
  activeNs: string | null;
  selectNamespace: (id: string) => void;
  /** Creates a workspace and sets `selfName` as your name in it (asked in the same dialog). */
  createNamespace: (name: string, selfName?: string) => Promise<CreateWorkspaceResult>;
  createNamespaceError: Error | null;
  /**
   * Mints an invitation (a passkey step-up) naming this app's team, and
   * answers the link to share; `appOnly` when it gives this app only (an org
   * that keeps its apps apart).
   */
  invite: () => Promise<{ link: string; appOnly: boolean }>;
  /**
   * The signed-in account leaves the open workspace (a passkey step-up): in
   * an org that keeps its apps apart, Mero Issue Tracker only; when that was
   * their last app there and `alsoOrg()` agrees, the organization too.
   * Elsewhere the organization. The workspace is closed afterwards. Throws
   * on failure.
   */
  leaveWorkspace: (alsoOrg: () => boolean) => Promise<{ left: 'app' | 'org'; lastApp: boolean }>;

  repos: RepoEntry[];
  activeRepo: string | null;
  /** The open repo runs another release: this page is moving to its frontend. */
  leaving: boolean;
  selectRepo: (id: string) => void;
  addRepo: (name: string, repoUrl: string) => Promise<string | null>;
  addRepoError: Error | null;
  reposLoading: boolean;

  /** The signed-in ACCOUNT: what `createdBy` and `author` name. */
  selfIdentity: string;
  /** Everyone who has this app in the workspace (its app team, else the org), people only. */
  members: string[];
  memberNames: Map<string, string>;
  roles: UseMemberRolesReturn;
  membersLoading: boolean;
  membersLoaded: boolean;
  setMemberName: (name: string) => Promise<void>;
  refetchMembers: () => Promise<void>;

  /** The active repo's URL (shared state), '' when unset. */
  repoUrl: string;
  setRepoUrl: (url: string) => Promise<void>;
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(describeError(e));
}

export function useWorkspace(): UseWorkspaceReturn {
  const { client, accountId, source, passkey, after } = useSignedIn();

  // ── workspaces ────────────────────────────────────────────────────────────
  const [namespaces, setNamespaces] = useState<Workspace[]>([]);
  const [namespacesPending, setNamespacesPending] = useState(true);
  const [namespacesFailed, setNamespacesFailed] = useState(false);
  const [activeNs, setActiveNs] = useState<string | null>(null);
  const [createNamespaceError, setCreateNamespaceError] = useState<Error | null>(null);

  const loadNamespaces = useCallback(async (): Promise<Workspace[] | null> => {
    try {
      const list = await listWorkspaces(client, source);
      setNamespaces(list);
      setNamespacesFailed(false);
      return list;
    } catch {
      setNamespacesFailed(true);
      return null;
    } finally {
      setNamespacesPending(false);
      after();
    }
  }, [client, source, after]);

  // The workspace chosen last time, if this account is still in it. Never one
  // picked silently: with none, the onboarding screen offers the list.
  useEffect(() => {
    void loadNamespaces().then((list) => {
      if (!list) return;
      const remembered = readActiveNs();
      setActiveNs((current) => current ?? (list.some((n) => n.namespaceId === remembered) ? remembered : null));
    });
  }, [loadNamespaces]);

  const selectNamespace = useCallback((id: string) => {
    writeActiveNs(id);
    setActiveNs(id);
  }, []);

  // An invitation just redeemed: re-read the list and open that workspace.
  useEffect(() => {
    const onJoined = (e: Event) => {
      const org = (e as CustomEvent<string>).detail;
      void loadNamespaces().then(() => selectNamespace(org));
    };
    window.addEventListener(JOINED_EVENT, onJoined);
    return () => window.removeEventListener(JOINED_EVENT, onJoined);
  }, [loadNamespaces, selectNamespace]);

  const createNamespace = useCallback(
    async (name: string, selfName?: string): Promise<CreateWorkspaceResult> => {
      setCreateNamespaceError(null);
      try {
        const { namespaceId, warning } = await createWorkspace(client, name, passkey, source);
        // Your name in the new workspace, before it opens so the name gate never
        // shows. Best effort: if it fails the workspace exists anyway, and the
        // gate asks for the name on entering it.
        if (selfName?.trim()) await setOrgName(client, namespaceId, accountId, selfName).catch(() => {});
        await loadNamespaces();
        selectNamespace(namespaceId);
        return { namespaceId, warning };
      } catch (e) {
        setCreateNamespaceError(asError(e));
        return { namespaceId: null, warning: null };
      } finally {
        after();
      }
    },
    [client, source, accountId, passkey, loadNamespaces, selectNamespace, after],
  );


  // "Connect to an existing organization": this app goes into an org the
  // account has for another app only on this explicit choice, with a first one.
  const loadOtherOrgs = useCallback(async () => {
    try {
      return await otherOrgs(client, source);
    } finally {
      after();
    }
  }, [client, source, after]);
  const connectOrg = useCallback(
    async (org: OtherOrg) => {
      try {
        await addRepoTo(client, source, org.orgId, 'Issues', '', passkey, after);
      } finally {
        after();
      }
      await loadNamespaces();
      selectNamespace(org.orgId);
    },
    [client, source, passkey, after, loadNamespaces, selectNamespace],
  );

  // ── repos ─────────────────────────────────────────────────────────────────
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  // A repo is an app instance, served the frontend of the release it runs.
  // The one picked is stored (`writeActiveRepo`), else it is the list's
  // first, so the other release reopens it.
  const leaving = useInstanceRelease(client, activeRepo);
  const [addRepoError, setAddRepoError] = useState<Error | null>(null);

  const loadRepos = useCallback(async () => {
    if (!activeNs) {
      setRepos([]);
      setActiveRepo(null);
      return;
    }
    setReposLoading(true);
    try {
      const list = await listRepos(client, source, activeNs);
      setRepos(list);
      setActiveRepo((current) => {
        if (current && list.some((r) => r.contextId === current)) return current;
        const remembered = readActiveRepo(activeNs);
        if (remembered && list.some((r) => r.contextId === remembered)) return remembered;
        return list[0]?.contextId ?? null;
      });
    } catch {
      // Kept as it was: the next focus tries again.
    } finally {
      setReposLoading(false);
      after();
    }
  }, [client, source, activeNs, after]);

  useEffect(() => {
    setActiveRepo(null);
    setRepos([]);
    void loadRepos();
    // Only on a workspace change; `loadRepos` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNs]);

  const selectRepo = useCallback(
    (id: string) => {
      if (activeNs) writeActiveRepo(activeNs, id);
      setActiveRepo(id);
    },
    [activeNs],
  );

  const addRepo = useCallback(
    async (name: string, repoUrl: string): Promise<string | null> => {
      if (!activeNs) return null;
      setAddRepoError(null);
      try {
        const id = await addRepoTo(client, source, activeNs, name, repoUrl, passkey, after);
        await loadRepos();
        selectRepo(id);
        return id;
      } catch (e) {
        setAddRepoError(asError(e));
        return null;
      } finally {
        after();
      }
    },
    [client, source, passkey, activeNs, loadRepos, selectRepo, after],
  );

  // ── members ───────────────────────────────────────────────────────────────
  const [org, setOrg] = useState<OrgMembers | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const orgFor = useRef<string | null>(null);

  const refetchMembers = useCallback(async () => {
    if (!activeNs) return;
    setMembersLoading(true);
    try {
      const next = await readMembers(client, activeNs, source);
      if (orgFor.current === activeNs) setOrg(next);
    } catch {
      /* the last answer stays; the next focus tries again */
    } finally {
      setMembersLoading(false);
      setMembersLoaded(true);
      after();
    }
  }, [client, activeNs, source, after]);

  useEffect(() => {
    orgFor.current = activeNs;
    setOrg(null);
    setMembersLoaded(false);
    void refetchMembers();
  }, [activeNs, refetchMembers]);

  const roles = useMemberRoles({
    client,
    org: activeNs,
    self: accountId,
    state: org,
    refetch: refetchMembers,
    passkey,
    after,
    source,
  });

  const setMemberName = useCallback(
    async (name: string) => {
      if (!activeNs) return;
      try {
        await setOrgName(client, activeNs, accountId, name);
      } finally {
        after();
      }
      await refetchMembers();
    },
    [client, activeNs, accountId, refetchMembers, after],
  );

  const invite = useCallback(async () => {
    if (!activeNs) throw new Error('No workspace is open.');
    try {
      const { token, appOnly } = await inviteToken(client, activeNs, passkey(), source);
      return { link: inviteLink(token, activeNs), appOnly };
    } finally {
      after();
    }
  }, [client, activeNs, passkey, source, after]);

  // ── the active repo's URL ─────────────────────────────────────────────────
  const [repoUrl, setRepoUrlState] = useState('');
  const board = useMemo(
    () => (activeRepo ? new MeroIssueTrackerClient(client, activeRepo, { after }) : null),
    [client, activeRepo, after],
  );
  useEffect(() => {
    setRepoUrlState('');
    if (!board) return;
    let live = true;
    board
      .getRepoInfo()
      .then(toRepoInfo)
      .then((info) => {
        if (live) setRepoUrlState(info.repoUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [board]);
  const setRepoUrl = useCallback(
    async (url: string) => {
      if (!board) return;
      await board.setRepoUrl({ url });
      setRepoUrlState(url);
    },
    [board],
  );

  const leave = useCallback(
    async (alsoOrg: () => boolean) => {
      if (!activeNs) throw new Error('No workspace is open.');
      const org = activeNs;
      try {
        const left = await leaveWorkspace(client, org, source, passkey, accountId);
        if (left.left === 'app' && left.lastApp && alsoOrg()) {
          await leaveWorkspaceOrg(client, org, passkey, accountId);
        }
        writeActiveNs(null);
        setActiveNs(null);
        await loadNamespaces();
        return left;
      } finally {
        after();
      }
    },
    [client, activeNs, source, passkey, accountId, loadNamespaces, after],
  );

  // Org-level changes have no event stream: re-read on focus.
  useEffect(() => {
    const onFocus = () => {
      void loadNamespaces();
      void loadRepos();
      void refetchMembers();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadNamespaces, loadRepos, refetchMembers]);

  const members = useMemo(
    () => (org?.people ?? []).filter((a) => a !== accountId).sort(),
    [org, accountId],
  );

  return {
    loadOtherOrgs,
    connectOrg,
    namespacesPending,
    namespacesFailed,
    retryNamespaces: () => void loadNamespaces(),
    namespaces,
    activeNs,
    selectNamespace,
    createNamespace,
    createNamespaceError,
    invite,
    leaveWorkspace: leave,
    repos,
    activeRepo,
    leaving,
    selectRepo,
    addRepo,
    addRepoError,
    reposLoading,
    selfIdentity: accountId,
    members: [accountId, ...members],
    memberNames: org?.names ?? new Map(),
    roles,
    membersLoading,
    membersLoaded,
    setMemberName,
    refetchMembers,
    repoUrl,
    setRepoUrl,
  };
}
