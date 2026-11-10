/**
 * useWorkspace — the workspace (an organization) and the spreadsheets inside it
 * (instances of this app in that organization).
 *
 * Model on Calimero 1.0 (see `lib/workspaces` for the v1 mapping):
 *  - The workspace is one org this account is in: the one an invitation just
 *    joined, else the one open before a reload, else the first org holding a
 *    spreadsheet, else the first org. None until the first spreadsheet is
 *    created, which creates it.
 *  - `contextId` is the open spreadsheet's app instance id (null = the picker).
 *    Every member of the org reaches every instance in it, so opening one is
 *    immediate: there is no identity to resolve and nothing to sync first.
 *  - A reload reopens the spreadsheet you had open, once the cluster confirms
 *    you still reach it (see `lib/lastWorkspace`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { otherOrgs, targetKey, type OtherOrg } from '@calimero-apps/connect';
import { describeError } from '../utils/errors';
import { APP_DISPLAY_NAME } from '../config';
import { useSignedIn } from '../sessionContext';
import {
  createSpreadsheet,
  ensureWorkspace,
  listInstances,
  listOrgs,
  mintInvite,
  namespaceLabel,
  spreadsheetFallbackLabel,
  spreadsheetsIn,
  type AcceptedInvite,
  type WorkspaceOrg,
} from '../lib/workspaces';
import {
  forgetLastSpreadsheet,
  forgetLastWorkspace,
  pickNamespace,
  pickResume,
  readLastWorkspace,
  rememberWorkspace,
} from '../lib/lastWorkspace';
import type { AppInfo } from '@calimero-network/mero-js';

export interface Workspace {
  contextId: string;
  name: string;
  /** True when `name` is a placeholder rather than something someone typed. */
  unnamed: boolean;
}

export interface UseWorkspaceReturn {
  /** Every spreadsheet in the workspace — the list to pick from. */
  workspaces: Workspace[];
  /** The workspace's org id, or null before one exists for this account. */
  namespaceId: string | null;
  /** Its human name. Never a bare id — see `namespaceLabel`. */
  namespaceName: string;
  /** The caller's role in the workspace org (`owner`, `admin`, `member`, `guest`). */
  orgRole: string | null;
  /** The open spreadsheet's app instance id — null when showing the picker. */
  contextId: string | null;
  /** True while the cluster is read to decide whether to reopen the last spreadsheet. */
  resuming: boolean;
  /** The open spreadsheet's name, as the picker knows it. */
  activeName: string;
  /** True once a spreadsheet is open. */
  ready: boolean;
  loading: boolean;
  /** True once a press of "create" would do what it says. */
  canCreate: boolean;
  /** What a multi-step operation is currently doing, for the UI to echo. */
  status: string | null;
  error: Error | null;
  /** The workspace list failed: create stays off until a retry answers. */
  namespacesFailed: boolean;
  retryNamespaces: () => void;
  openWorkspace: (contextId: string) => void;
  createWorkspace: (name: string) => Promise<void>;
  /** The name a freshly-created spreadsheet should be initialised with. */
  pendingInitName: string | null;
  clearPendingInit: () => void;
  leaveWorkspace: () => void;
  /** Mint a shareable invitation link for this workspace (a passkey step-up). */
  invite: (opts?: { contextId?: string | null }) => Promise<string>;
  inviteLoading: boolean;
  /** Land a join the invitation prompt completed: re-read and open what the link named. */
  landJoined: (landed: AcceptedInvite) => Promise<void>;
  /** Re-read orgs and instances from the cluster. */
  refresh: () => Promise<void>;
  /** The account's other orgs, where a spreadsheet may be added ("Connect to an existing organization"). */
  loadOtherOrgs: () => Promise<OtherOrg[]>;
  /** Create a spreadsheet (`name`, else "Untitled spreadsheet") in `org` and open it. Throws on failure. */
  connectWorkspace: (org: OtherOrg, name?: string) => Promise<void>;
}

/** The name of a spreadsheet created by connecting an org without one typed. */
export const CONNECTED_SPREADSHEET_NAME = 'Untitled spreadsheet';

export function useWorkspace(): UseWorkspaceReturn {
  const { client, accountId, target, source, passkey, after } = useSignedIn();
  // Remembered per cluster and per account.
  const memoryKey = `${targetKey(target)}:${accountId}`;
  const remembered = useMemo(() => readLastWorkspace(memoryKey), [memoryKey]);

  const [orgs, setOrgs] = useState<WorkspaceOrg[]>([]);
  const [instances, setInstances] = useState<AppInfo[]>([]);
  const [listed, setListed] = useState(false);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<Error | null>(null);
  const [joinedNsId, setJoinedNsId] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pendingInitName, setPendingInitName] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [resumeSettled, setResumeSettled] = useState(() => !readLastWorkspace(memoryKey).contextId);

  const refresh = useCallback(async () => {
    setListing(true);
    try {
      const [o, apps] = await Promise.all([listOrgs(client), listInstances(client, source)]);
      setOrgs(o);
      setInstances(apps);
      setListError(null);
      setListed(true);
    } catch (e) {
      setListError(e instanceof Error ? e : new Error(describeError(e)));
    } finally {
      setListing(false);
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The workspace: the one just joined, else the one open last, else the first
  // org holding a spreadsheet. Never an org that holds none (one made for
  // another app): with no workspace, creating a spreadsheet creates one, and
  // another org is used only when chosen under "Connect to an existing
  // organization" (or an invite just joined it).
  const withSheets = orgs.filter((o) => instances.some((a) => a.org === o.orgId)).map((o) => o.orgId);
  const joinedListed = joinedNsId && orgs.some((o) => o.orgId === joinedNsId) && !withSheets.includes(joinedNsId);
  const pickedNsId = pickNamespace(
    joinedListed ? [...withSheets, joinedNsId] : withSheets,
    joinedNsId,
    remembered.namespaceId,
  );
  const org = orgs.find((o) => o.orgId === pickedNsId) ?? null;
  const namespaceId = org?.orgId ?? null;
  const namespaceName = org ? namespaceLabel({ namespaceId: org.orgId, name: org.name }, APP_DISPLAY_NAME) : APP_DISPLAY_NAME;
  const workspaces = useMemo(() => (namespaceId ? spreadsheetsIn(instances, namespaceId) : []), [instances, namespaceId]);

  const openWorkspace = useCallback((id: string) => {
    setError(null);
    setContextId(id);
  }, []);

  const leaveWorkspace = useCallback(() => {
    forgetLastSpreadsheet(memoryKey);
    setResumeSettled(true);
    setContextId(null);
    setPendingInitName(null);
    setStatus(null);
    setError(null);
  }, [memoryKey]);

  const clearPendingInit = useCallback(() => setPendingInitName(null), []);

  const creatingRef = useRef(false);
  const createWorkspace = useCallback(
    async (name: string) => {
      if (!listed || listError || creatingRef.current) return;
      creatingRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const { orgId, warning } = await ensureWorkspace(
          client,
          { existing: namespaceId, name: APP_DISPLAY_NAME, passkey },
          setStatus,
        );
        const appId = await createSpreadsheet(client, source, orgId, name, setStatus);
        if (warning) setError(new Error(warning));
        setJoinedNsId(orgId);
        setContextId(appId);
        setPendingInitName(name); // AppPage runs init_project once ready
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err : new Error(describeError(err)));
      } finally {
        creatingRef.current = false;
        setBusy(false);
        setStatus(null);
        after();
      }
    },
    [client, source, passkey, after, listed, listError, namespaceId, refresh],
  );

  const loadOtherOrgs = useCallback(async () => {
    try {
      return await otherOrgs(client, source);
    } finally {
      after();
    }
  }, [client, source, after]);

  const connectWorkspace = useCallback(
    async (target: OtherOrg, name?: string) => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      setBusy(true);
      setError(null);
      const title = name?.trim() || CONNECTED_SPREADSHEET_NAME;
      try {
        const appId = await createSpreadsheet(client, source, target.orgId, title, setStatus);
        setJoinedNsId(target.orgId);
        setContextId(appId);
        setPendingInitName(title);
        await refresh();
      } finally {
        creatingRef.current = false;
        setBusy(false);
        setStatus(null);
        after();
      }
    },
    [client, source, after, refresh],
  );

  const activeName = useMemo(() => {
    if (!contextId) return APP_DISPLAY_NAME;
    const row = workspaces.find((w) => w.contextId === contextId);
    if (row) return row.name;
    const inst = instances.find((a) => a.appId === contextId);
    return inst?.name?.trim() || spreadsheetFallbackLabel(contextId);
  }, [contextId, workspaces, instances]);

  const invite = useCallback(
    async (opts?: { contextId?: string | null }) => {
      if (!namespaceId) throw new Error('No workspace yet — create a spreadsheet first.');
      setInviteLoading(true);
      try {
        return await mintInvite(client, { org: namespaceId, sheet: opts?.contextId ?? null, passkey }, setStatus);
      } finally {
        setInviteLoading(false);
        setStatus(null);
        after();
      }
    },
    [client, namespaceId, passkey, after],
  );

  const landJoined = useCallback(
    async (landed: AcceptedInvite) => {
      if (landed.namespaceId) setJoinedNsId(landed.namespaceId);
      await refresh();
      if (landed.contextId) openWorkspace(landed.contextId);
    },
    [refresh, openWorkspace],
  );

  // Reopen the spreadsheet open before the reload, once the cluster has
  // answered and only if this account still reaches it.
  useEffect(() => {
    if (resumeSettled) return;
    if (contextId) {
      setResumeSettled(true);
      return;
    }
    if (!listed) return;
    setResumeSettled(true);
    const target = pickResume(namespaceId, workspaces.map((w) => w.contextId), remembered);
    if (target) openWorkspace(target);
    else if (namespaceId === remembered.namespaceId) forgetLastSpreadsheet(memoryKey);
    else forgetLastWorkspace(memoryKey);
  }, [resumeSettled, contextId, listed, namespaceId, workspaces, remembered, openWorkspace, memoryKey]);

  // Remember what is open, paired with its workspace once that lists it.
  useEffect(() => {
    if (!contextId || !namespaceId) return;
    if (!workspaces.some((w) => w.contextId === contextId)) return;
    rememberWorkspace(memoryKey, namespaceId, contextId);
  }, [memoryKey, namespaceId, contextId, workspaces]);

  return {
    workspaces,
    namespaceId,
    namespaceName,
    orgRole: org?.role ?? null,
    contextId,
    resuming: !resumeSettled && !contextId,
    activeName,
    ready: contextId !== null,
    loading: (listing && !listed) || busy,
    canCreate: listed && !listError && !busy,
    status,
    error,
    namespacesFailed: !!listError && !listing,
    retryNamespaces: () => void refresh(),
    openWorkspace,
    createWorkspace,
    pendingInitName,
    clearPendingInit,
    leaveWorkspace,
    invite,
    inviteLoading,
    landJoined,
    refresh,
    loadOtherOrgs,
    connectWorkspace,
  };
}
