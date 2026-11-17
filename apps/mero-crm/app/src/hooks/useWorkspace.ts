/**
 * The active workspace (an org) and pipeline (an app instance in it), and the
 * people in the workspace.
 *
 * v1 resolved these from a node: the installed application, its namespaces,
 * their contexts, group members and aliases, kept live by the node's sync
 * stream. On Calimero 1.0 the account's orgs come from `/me`, a workspace's
 * pipelines from `listApps` (this app's bundle in dev, its package in production)
 * filtered by org, and members and their names from `getOrg`. Nothing has to
 * replicate before it shows, so v1's "syncing" and "warming up" states are gone;
 * org-level changes (a new pipeline, a new member) are re-read when the window
 * regains focus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError, otherOrgs, type OtherOrg } from '@calimero-apps/connect';
import { setOrgName } from '@calimero-apps/names';
import { useInstanceRelease } from '@calimero-apps/passkey';

import { useSignedIn } from '../sessionContext';
import {
  addPipeline as addPipelineTo,
  finishWorkspace,
  leaveWorkspace,
  leaveWorkspaceOrg,
  listPipelines,
  listWorkspaces,
  readMembers,
  type OrgMembers,
  type PipelineEntry,
  type Workspace,
} from '../workspaces';
import { useMemberRoles, type UseMemberRolesReturn } from './useMemberRoles';
import {
  JOINED_EVENT,
  readActiveNs,
  readActivePipeline,
  writeActiveNs,
  writeActivePipeline,
} from './workspacePersistence';

export type { PipelineEntry, Workspace };

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
  /** Finishes a workspace the node approved (its team, your name in it) and opens it. Answers a notice to show, or `null`. */
  workspaceCreated: (created: { orgId: string; selfName: string }) => Promise<string | null>;
  /** The newest release is still being read: creates (workspace, pipeline, connect) wait for it. */
  sourcePending: boolean;
  /** The teams an invite to the open workspace names: this app's, where it has one. */
  inviteTeams: string[];
  /**
   * The signed-in account leaves the open workspace (a passkey step-up): in
   * an org that keeps its apps apart, Hyperfeed CRM only; when that was their last
   * app there and `alsoOrg()` agrees, the organization too. Elsewhere the
   * organization. The workspace is closed afterwards. Throws on failure.
   */
  leaveWorkspace: (alsoOrg: () => boolean) => Promise<{ left: 'app' | 'org'; lastApp: boolean }>;

  pipelines: PipelineEntry[];
  activePipeline: string | null;
  /** The open pipeline runs another release: this page is moving to its frontend. */
  leaving: boolean;
  selectPipeline: (id: string) => void;
  addPipeline: (name: string, currency: string) => Promise<string | null>;
  addPipelineError: Error | null;
  pipelinesLoading: boolean;

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
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(describeError(e));
}

export function useWorkspace(): UseWorkspaceReturn {
  const { client, accountId, source, sourcePending, passkey, after } = useSignedIn();

  // ── workspaces ────────────────────────────────────────────────────────────
  const [namespaces, setNamespaces] = useState<Workspace[]>([]);
  const [namespacesPending, setNamespacesPending] = useState(true);
  const [namespacesFailed, setNamespacesFailed] = useState(false);
  const [activeNs, setActiveNs] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeNs;

  const loadNamespaces = useCallback(async (): Promise<Workspace[] | null> => {
    try {
      const list = await listWorkspaces(client, source);
      setNamespaces(list);
      setNamespacesFailed(false);
      // Out of the open workspace (removed, or left elsewhere): close it and
      // go back to the workspace list, rather than failing every read in it.
      const open = activeRef.current;
      if (open && !list.some((n) => n.namespaceId === open)) {
        writeActiveNs(null);
        activeRef.current = null;
        setActiveNs(null);
      }
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

  const workspaceCreated = useCallback(
    async ({ orgId, selfName }: { orgId: string; selfName: string }): Promise<string | null> => {
      const { warning } = await finishWorkspace(client, orgId, passkey, source);
      // Your name in the new workspace, before it opens so the name gate never
      // shows. Best effort: the gate asks for it on entering if this fails.
      if (selfName.trim()) await setOrgName(client, orgId, accountId, selfName).catch(() => {});
      await loadNamespaces();
      selectNamespace(orgId);
      after();
      return warning;
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
        await addPipelineTo(client, source, org.orgId, 'Pipeline', 'USD', passkey, after);
      } finally {
        after();
      }
      await loadNamespaces();
      selectNamespace(org.orgId);
    },
    [client, source, passkey, after, loadNamespaces, selectNamespace],
  );

  // ── pipelines ─────────────────────────────────────────────────────────────────
  const [pipelines, setPipelines] = useState<PipelineEntry[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(false);
  const [activePipeline, setActivePipeline] = useState<string | null>(null);
  // A pipeline is an app instance, served the frontend of the release it runs.
  // The one picked is stored (`writeActivePipeline`), else it is the list's
  // first, so the other release reopens it.
  const leaving = useInstanceRelease(client, activePipeline);
  const [addPipelineError, setAddPipelineError] = useState<Error | null>(null);

  const loadPipelines = useCallback(async () => {
    if (!activeNs) {
      setPipelines([]);
      setActivePipeline(null);
      return;
    }
    setPipelinesLoading(true);
    try {
      const list = await listPipelines(client, source, activeNs);
      setPipelines(list);
      setActivePipeline((current) => {
        if (current && list.some((r) => r.contextId === current)) return current;
        const remembered = readActivePipeline(activeNs);
        if (remembered && list.some((r) => r.contextId === remembered)) return remembered;
        return list[0]?.contextId ?? null;
      });
    } catch {
      // Kept as it was: the next focus tries again.
    } finally {
      setPipelinesLoading(false);
      after();
    }
  }, [client, source, activeNs, after]);

  useEffect(() => {
    setActivePipeline(null);
    setPipelines([]);
    void loadPipelines();
    // Only on a workspace change; `loadPipelines` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNs]);

  const selectPipeline = useCallback(
    (id: string) => {
      if (activeNs) writeActivePipeline(activeNs, id);
      setActivePipeline(id);
    },
    [activeNs],
  );

  const addPipeline = useCallback(
    async (name: string, currency: string): Promise<string | null> => {
      if (!activeNs) return null;
      setAddPipelineError(null);
      try {
        const id = await addPipelineTo(client, source, activeNs, name, currency, passkey, after);
        await loadPipelines();
        selectPipeline(id);
        return id;
      } catch (e) {
        setAddPipelineError(asError(e));
        return null;
      } finally {
        after();
      }
    },
    [client, source, passkey, activeNs, loadPipelines, selectPipeline, after],
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
      void loadPipelines();
      void refetchMembers();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadNamespaces, loadPipelines, refetchMembers]);

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
    workspaceCreated,
    sourcePending,
    inviteTeams: org?.appTeam ? [org.appTeam] : [],
    leaveWorkspace: leave,
    pipelines,
    activePipeline,
    leaving,
    selectPipeline,
    addPipeline,
    addPipelineError,
    pipelinesLoading,
    selfIdentity: accountId,
    members: [accountId, ...members],
    memberNames: org?.names ?? new Map(),
    roles,
    membersLoading,
    membersLoaded,
    setMemberName,
    refetchMembers,
  };
}
