/**
 * useWorkspace — the Calimero workspace and the spreadsheets inside it.
 *
 * Model:
 *  - The app installs as a Calimero application. One NAMESPACE per node holds
 *    this app's spreadsheets; each SPREADSHEET is one context bound to the
 *    namespace root. There are no subgroups, so one membership covers
 *    everything — which is what an invitation grants and what the UI says.
 *  - `contextId` is the open spreadsheet (null = show the picker).
 *  - When launched from the desktop app (SSO), `useMero()` carries a `contextId`
 *    and `contextIdentity` from the auth callback — open that directly.
 *
 * ── What changed here, and why ──────────────────────────────────────────────
 *
 * 1. The application id is resolved FROM THE NODE by package, not taken from
 *    the session or a baked env var. See `lib/appId` — both of the old sources
 *    describe how you arrived, not which app you are.
 * 2. Spreadsheet names come from the node, not from a `localStorage` map keyed
 *    by context id. That map was per-browser: the creator saw "Q3 Budget" and
 *    every person they invited saw "Workspace 1", because the name had never
 *    been sent anywhere.
 * 3. Opening a spreadsheet JOINS its context when this node holds no identity
 *    in it. Waiting for auto-follow — which only carries identities into
 *    contexts created after you joined — is why an invited collaborator could
 *    sit on "Opening workspace…" indefinitely with nothing logged.
 * 4. Invitations are minted here and redeemed by the app-level
 *    `InvitationPrompt` once an opened link is accepted; `landJoined` is the
 *    half of a join that needs this hook's state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  markNamespaceJustJoined,
  useJoinSync,
  useMero,
  useNamespacesForApplication,
  useGroupContexts,
} from '@calimero-network/mero-react';
import { APP_DISPLAY_NAME, PRIMARY_SERVICE } from '../config';
import { useApplicationId } from './useApplicationId';
import {
  createSpreadsheet,
  enterSpreadsheet,
  ensureNamespace,
  listSpreadsheets,
  mintInvite,
  namespaceLabel,
  spreadsheetFallbackLabel,
  type AcceptedInvite,
  type SpreadsheetRow,
} from '../lib/workspaces';

export interface Workspace {
  contextId: string;
  name: string;
  /** True when `name` is a placeholder rather than something someone typed. */
  unnamed: boolean;
}

export interface UseWorkspaceReturn {
  /** Every spreadsheet in the workspace — the list to pick from. */
  /** A namespace joined this session whose spreadsheets have not arrived yet. */
  isSyncing: boolean;
  dismissSyncing: () => void;
  workspaces: Workspace[];
  /** The namespace holding them, or null before one exists on this node. */
  namespaceId: string | null;
  /** Its human name. Never a bare id — see `namespaceLabel`. */
  namespaceName: string;
  /** The open spreadsheet's context id — null when showing the picker. */
  contextId: string | null;
  /** Executor public key for the open context (the signer for RPC calls). */
  executorPublicKey: string | null;
  /** The open spreadsheet's name, as the picker knows it. */
  activeName: string;
  /** True once the open context is resolved and we hold its executor identity. */
  ready: boolean;
  loading: boolean;
  /**
   * True once a press of "create" would do what it says: this app's id and its
   * namespace (or the lack of one) are known, and no create is running. Unlike
   * `loading` it does not flicker while the node is read, so a press is never
   * dropped on a button that was on a frame ago.
   */
  canCreate: boolean;
  /** What a multi-step operation is currently doing, for the UI to echo. */
  status: string | null;
  error: Error | null;
  /** True when the node has answered and this app is not installed on it. */
  notInstalled: boolean;
  openWorkspace: (contextId: string) => void;
  createWorkspace: (name: string) => Promise<void>;
  /** The name a freshly-created spreadsheet should be initialised with. */
  pendingInitName: string | null;
  clearPendingInit: () => void;
  leaveWorkspace: () => void;
  /** Mint a shareable invite code for this workspace. */
  invite: (opts?: { contextId?: string | null; projectName?: string }) => Promise<string>;
  inviteLoading: boolean;
  /**
   * Land a join the invitation prompt completed: re-read the node and open the
   * spreadsheet the link named, if it named one.
   */
  landJoined: (landed: Pick<AcceptedInvite, 'namespaceId' | 'contextId'>) => Promise<void>;
  /** Re-read namespaces and contexts from the node. */
  refresh: () => Promise<void>;
}

export function useWorkspace(): UseWorkspaceReturn {
  const {
    mero,
    contextId: callbackContextId,
    contextIdentity: callbackContextIdentity,
  } = useMero();
  const { appId: applicationId, resolving: appIdResolving, notInstalled } =
    useApplicationId();

  const {
    namespaces,
    loading: nsLoading,
    refetch: refetchNamespaces,
  } = useNamespacesForApplication(applicationId || null);

  // A workspace joined by invitation this session, once the node lists it.
  const [joinedNsId, setJoinedNsId] = useState<string | null>(null);

  // The app's namespace: the one just joined, else the first one bound to this
  // application. null on first run. Preferring the joined one is what lands an
  // invited person who already had a workspace in the one they were invited
  // to, and what lets the join-sync gate below see that workspace's list.
  const namespace =
    namespaces.find((n) => n.namespaceId === joinedNsId) ?? namespaces[0] ?? null;
  const namespaceId = namespace?.namespaceId ?? null;
  const namespaceName = namespace
    ? namespaceLabel(namespace, APP_DISPLAY_NAME)
    : APP_DISPLAY_NAME;

  const {
    contexts: nsContexts,
    loading: ctxLoading,
    refetch: refetchContexts,
  } = useGroupContexts(namespaceId);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  /** The namespace whose spreadsheet list has been read at least once. */
  const [listedForNs, setListedForNs] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string | null>(callbackContextId);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(
    callbackContextIdentity,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pendingInitName, setPendingInitName] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  // Desktop SSO: the auth callback pins a specific context — open it directly.
  useEffect(() => {
    if (callbackContextId) {
      setContextId(callbackContextId);
      if (callbackContextIdentity) setExecutorPublicKey(callbackContextIdentity);
    }
  }, [callbackContextId, callbackContextIdentity]);

  // Resolve the spreadsheet names from the node whenever the context list moves.
  //
  // A separate effect rather than a `useMemo` because it is asynchronous: the
  // names live in replicated metadata records, one read per context. Keyed on
  // the context ids so it does not re-run on every unrelated render.
  const contextKey = nsContexts.map((c) => c.contextId).join(',');
  useEffect(() => {
    if (!mero || !namespaceId) {
      setWorkspaces([]);
      return;
    }
    let cancelled = false;
    void listSpreadsheets(mero.admin, namespaceId, nsContexts).then(
      (rows: SpreadsheetRow[]) => {
        if (cancelled) return;
        setWorkspaces(rows);
        // Settled means "a real read came back", including an empty one — a
        // workspace with no spreadsheets yet is an answer, not a pending state.
        setListedForNs(namespaceId);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mero, namespaceId, contextKey]);

  // Get an executor identity in the open context — joining it when this node
  // holds none, which is ALWAYS the case for a spreadsheet you were invited to.
  useEffect(() => {
    if (!mero || !contextId || executorPublicKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const identity = await enterSpreadsheet(mero.admin, contextId, (s) => {
          if (!cancelled) setStatus(s);
        });
        if (!cancelled) {
          setExecutorPublicKey(identity);
          setStatus(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mero, contextId, executorPublicKey]);

  const refresh = useCallback(async () => {
    await Promise.all([refetchNamespaces(), refetchContexts()]);
  }, [refetchNamespaces, refetchContexts]);

  const openWorkspace = useCallback((id: string) => {
    setError(null);
    setExecutorPublicKey(null); // force identity re-resolution for the new context
    setContextId(id);
  }, []);

  const leaveWorkspace = useCallback(() => {
    setContextId(null);
    setExecutorPublicKey(null);
    setPendingInitName(null);
    setStatus(null);
    setError(null);
  }, []);

  const clearPendingInit = useCallback(() => setPendingInitName(null), []);

  // Whether this app's namespaces have been read for the current app id.
  //
  // `loading` alone cannot say: mero-react's resource hooks report themselves
  // in flight only from the render AFTER their inputs change, so between the
  // app id resolving and the namespace read starting there is a render with
  // nothing loading and no namespace. Gating "create" on `loading` turned the
  // button on in that render and off again in the next (and once more between
  // the namespace and the context reads), and a press in one of those frames
  // hit a disabled button and was lost. A press in the very first one was
  // worse: with no namespace known yet, create would have made a second one.
  // So: settled means a read for this id was seen in flight and then ended.
  const nsReadStartedFor = useRef<string | null>(null);
  const [nsSettledFor, setNsSettledFor] = useState<string | null>(null);
  useEffect(() => {
    if (!applicationId) return;
    if (nsLoading) nsReadStartedFor.current = applicationId;
    else if (nsReadStartedFor.current === applicationId) setNsSettledFor(applicationId);
  }, [applicationId, nsLoading]);
  const namespaceKnown = !!applicationId && nsSettledFor === applicationId;

  const creatingRef = useRef(false);
  const createWorkspace = useCallback(
    async (name: string) => {
      if (!mero || !applicationId || !namespaceKnown || creatingRef.current) return;
      creatingRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const nsId = await ensureNamespace(
          mero.admin,
          {
            applicationId,
            existingNamespaceId: namespaceId,
            // The namespace is what an invitation names, so it gets a readable
            // name too — `createNamespace` has always taken one and this app
            // never passed it, which is why every invite described itself with
            // a 64-hex group id.
            name: APP_DISPLAY_NAME,
          },
          setStatus,
        );
        const ctx = await createSpreadsheet(
          mero.admin,
          {
            applicationId,
            namespaceId: nsId,
            name,
            serviceName: PRIMARY_SERVICE.name,
          },
          setStatus,
        );
        setExecutorPublicKey(ctx.memberPublicKey);
        setContextId(ctx.contextId);
        setPendingInitName(name); // AppPage runs init_project once ready
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        creatingRef.current = false;
        setBusy(false);
        setStatus(null);
      }
    },
    [mero, applicationId, namespaceKnown, namespaceId, refresh],
  );

  const activeName = useMemo(() => {
    if (!contextId) return APP_DISPLAY_NAME;
    const row = workspaces.find((w) => w.contextId === contextId);
    return row?.name ?? spreadsheetFallbackLabel(contextId);
  }, [contextId, workspaces]);

  const invite = useCallback(
    async (opts?: { contextId?: string | null; projectName?: string }) => {
      if (!mero) throw new Error('Not connected to a node.');
      if (!namespaceId) {
        throw new Error('No workspace yet — create a spreadsheet first.');
      }
      setInviteLoading(true);
      try {
        return await mintInvite(
          mero.admin,
          {
            namespaceId,
            namespaceName,
            contextId: opts?.contextId ?? null,
            projectName: opts?.projectName,
          },
          setStatus,
        );
      } finally {
        setInviteLoading(false);
        setStatus(null);
      }
    },
    [mero, namespaceId, namespaceName],
  );

  const landJoined = useCallback(
    async (landed: Pick<AcceptedInvite, 'namespaceId' | 'contextId'>) => {
      // The join has returned; the workspace's own state has not arrived yet.
      // Without this the joiner lands on an empty spreadsheet list that looks
      // exactly like a workspace with nothing in it.
      if (landed.namespaceId) {
        markNamespaceJustJoined(landed.namespaceId);
        setJoinedNsId(landed.namespaceId);
      }
      await refresh();
      // The code can name a spreadsheet to open. It is an unsigned hint, so
      // the node still decides whether to admit us — `openWorkspace` goes
      // through `enterSpreadsheet`, which asks.
      if (landed.contextId) openWorkspace(landed.contextId);
    },
    [refresh, openWorkspace],
  );

  // Whether this namespace's context list has come back from the node. The
  // spreadsheet list alone cannot say: it is rebuilt the moment `namespaceId`
  // changes, from whatever contexts are on hand (none, or the previous
  // namespace's), so it would "settle" a just-joined workspace before reading
  // it at all. Same in-flight-then-ended test as `namespaceKnown` above, for
  // the same reason.
  const ctxReadStartedFor = useRef<string | null>(null);
  const [ctxSettledFor, setCtxSettledFor] = useState<string | null>(null);
  useEffect(() => {
    if (!namespaceId) return;
    if (ctxLoading) ctxReadStartedFor.current = namespaceId;
    else if (ctxReadStartedFor.current === namespaceId) setCtxSettledFor(namespaceId);
  }, [namespaceId, ctxLoading]);

  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId,
    settled: ctxSettledFor === namespaceId && listedForNs === namespaceId,
  });

  return {
    isSyncing,
    dismissSyncing,
    workspaces,
    namespaceId,
    namespaceName,
    contextId,
    executorPublicKey,
    activeName,
    ready: contextId !== null && executorPublicKey !== null,
    loading: appIdResolving || nsLoading || ctxLoading || busy,
    canCreate: namespaceKnown && !busy,
    status,
    error,
    notInstalled,
    openWorkspace,
    createWorkspace,
    pendingInitName,
    clearPendingInit,
    leaveWorkspace,
    invite,
    inviteLoading,
    landJoined,
    refresh,
  };
}
