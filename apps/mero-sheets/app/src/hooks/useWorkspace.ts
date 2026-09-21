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
 * 4. Invitations are minted and redeemed through `lib/workspaces` + the shared
 *    link/codec modules, so the paste path and the link path cannot drift.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMero,
  useNamespacesForApplication,
  useGroupContexts,
} from '@calimero-network/mero-react';
import { APP_DISPLAY_NAME, PRIMARY_SERVICE } from '../config';
import { useApplicationId } from './useApplicationId';
import { decodeInvite } from '../lib/inviteCodec';
import {
  acceptInvite,
  createSpreadsheet,
  enterSpreadsheet,
  ensureNamespace,
  listSpreadsheets,
  mintInvite,
  namespaceLabel,
  spreadsheetFallbackLabel,
  type SpreadsheetRow,
} from '../lib/workspaces';
import { markNamespaceJustJoined, useJoinSync } from '@calimero-apps/join-sync';

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
  /** Redeem an invitation link or code. */
  join: (codeOrLink: string) => Promise<void>;
  joinLoading: boolean;
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

  // The app's namespace (first one bound to this application). null on first run.
  const namespace = namespaces[0] ?? null;
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
  const [joinLoading, setJoinLoading] = useState(false);

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

  const creatingRef = useRef(false);
  const createWorkspace = useCallback(
    async (name: string) => {
      if (!mero || !applicationId || creatingRef.current) return;
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
    [mero, applicationId, namespaceId, refresh],
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

  const join = useCallback(
    async (codeOrLink: string) => {
      if (!mero) throw new Error('Not connected to a node.');
      const payload = decodeInvite(codeOrLink);
      if (!payload) {
        throw new Error(
          'That invitation could not be read. Paste the whole link you were sent.',
        );
      }
      setJoinLoading(true);
      setError(null);
      try {
        const landed = await acceptInvite(mero.admin, payload, setStatus);
        // The join has returned; the workspace's own state has not arrived yet.
        // Without this the joiner lands on an empty spreadsheet list that looks
        // exactly like a workspace with nothing in it.
        if (landed.namespaceId) markNamespaceJustJoined(landed.namespaceId);
        await refresh();
        // The code can name a spreadsheet to open. It is an unsigned hint, so
        // the node still decides whether to admit us — `openWorkspace` goes
        // through `enterSpreadsheet`, which asks.
        if (landed.contextId) openWorkspace(landed.contextId);
      } finally {
        setJoinLoading(false);
        setStatus(null);
      }
    },
    [mero, refresh, openWorkspace],
  );

  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId,
    settled: listedForNs === namespaceId,
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
    join,
    joinLoading,
    refresh,
  };
}
