/**
 * useWorkspace — manages the Calimero workspaces (contexts) this app can open.
 *
 * Workspace model:
 *  - The app installs as a Calimero application → a namespace. Each **workspace**
 *    is one context inside that namespace (a separate shared spreadsheet).
 *  - `useGroupContexts` lists every context in the namespace → the workspace list.
 *  - `contextId` is the *active* workspace (null = show the list). Opening a
 *    workspace resolves the executor identity we own in it; creating one makes a
 *    new context (and the namespace on first run) and opens it.
 *  - When launched from the desktop app (SSO), `useMero()` carries a `contextId`
 *    + `contextIdentity` from the auth callback — we open that directly.
 *  - Peers join a workspace via a namespace invitation (Invite/Join modals).
 *
 * Workspace display names are stored locally (keyed by contextId), since the
 * context list from the node carries ids, not the project name.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMero,
  useNamespacesForApplication,
  useCreateNamespaceInvitation,
  useJoinNamespace,
  useGroupContexts,
} from '@calimero-network/mero-react';
import { PRIMARY_SERVICE } from '../config';
import { decodeInvitation } from '../utils/invitation';

const ENV_APPLICATION_ID = import.meta.env.VITE_APPLICATION_ID?.trim() || null;

// Members can create per-namespace contexts + invite others. Mirrors core's
// MemberCapabilities bits (CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS).
const DEFAULT_CAPABILITIES = 1 | 2; // = 3

// ── Local name store ──────────────────────────────────────────────────────────
// The node returns context ids, not project names. We remember the name the
// creator typed (per contextId) so the workspace list is human-readable.
const NAME_KEY = 'p2p-sheets:workspace-names';

function loadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAME_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveName(contextId: string, name: string) {
  try {
    const all = loadNames();
    all[contextId] = name;
    localStorage.setItem(NAME_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export interface Workspace {
  contextId: string;
  name: string;
}

export interface UseWorkspaceReturn {
  /** Every workspace (context) in the namespace — the list to pick from. */
  workspaces: Workspace[];
  /** The active workspace's context id — null when showing the list. */
  contextId: string | null;
  /** Executor public key for the active context (the signer for RPC calls). */
  executorPublicKey: string | null;
  /** True once the active context is resolved and we hold its executor identity. */
  ready: boolean;
  loading: boolean;
  error: Error | null;
  /** Open an existing workspace by context id. */
  openWorkspace: (contextId: string) => void;
  /** Create a new workspace (namespace on first run) and open it. The caller
   *  runs `initProject(name)` once it becomes ready. */
  createWorkspace: (name: string) => Promise<void>;
  /** The name a freshly-created workspace should be initialised with, or null. */
  pendingInitName: string | null;
  /** Clear the pending init flag once the project has been initialised. */
  clearPendingInit: () => void;
  /** Return to the workspace list (close the active workspace). */
  leaveWorkspace: () => void;
  /** Mint a shareable invitation code for the current namespace. */
  invite: () => Promise<unknown>;
  inviteLoading: boolean;
  /** Join an existing workspace from a share code (base64 or raw JSON). */
  join: (code: string) => Promise<void>;
  joinLoading: boolean;
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

  // The app's namespace (first one bound to this application). null on first run.
  const namespaceId = namespaces[0]?.namespaceId ?? null;

  // Contexts inside that namespace — one per workspace.
  const { contexts: nsContexts, loading: ctxLoading, refetch: refetchContexts } =
    useGroupContexts(namespaceId);

  const [contextId, setContextId] = useState<string | null>(callbackContextId);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(
    callbackContextIdentity,
  );
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pendingInitName, setPendingInitName] = useState<string | null>(null);
  const [nameVersion, setNameVersion] = useState(0); // bump to re-read local names

  // Desktop SSO: the auth callback pins a specific context — open it directly.
  useEffect(() => {
    if (callbackContextId) {
      setContextId(callbackContextId);
      if (callbackContextIdentity) setExecutorPublicKey(callbackContextIdentity);
    }
  }, [callbackContextId, callbackContextIdentity]);

  // Resolve the executor identity we own in the active context. Runs whenever
  // the active context changes (executorPublicKey is reset to null on switch).
  useEffect(() => {
    if (!mero || !contextId || executorPublicKey) return;
    let cancelled = false;
    (async () => {
      try {
        const { identities } = await mero.admin.getContextIdentitiesOwned(contextId);
        if (!cancelled && identities.length > 0) setExecutorPublicKey(identities[0]);
      } catch {
        /* leave null — the workspace stays not-ready until an identity resolves */
      }
    })();
    return () => { cancelled = true; };
  }, [mero, contextId, executorPublicKey]);

  const workspaces: Workspace[] = useMemo(() => {
    const names = loadNames();
    // nameVersion is a dependency so the list re-derives after a create/rename.
    void nameVersion;
    return nsContexts.map((c, i) => ({
      contextId: c.contextId,
      name: names[c.contextId] || `Workspace ${i + 1}`,
    }));
  }, [nsContexts, nameVersion]);

  const openWorkspace = useCallback((id: string) => {
    setError(null);
    setExecutorPublicKey(null); // force identity re-resolution for the new context
    setContextId(id);
  }, []);

  const leaveWorkspace = useCallback(() => {
    setContextId(null);
    setExecutorPublicKey(null);
    setPendingInitName(null);
  }, []);

  const clearPendingInit = useCallback(() => setPendingInitName(null), []);

  const creatingRef = useRef(false);
  const createWorkspace = useCallback(
    async (name: string) => {
      if (!mero || !applicationId || creatingRef.current) return;
      creatingRef.current = true;
      setBootstrapping(true);
      setError(null);
      try {
        // Reuse the app's namespace, or create it on first run.
        let nsId = namespaceId;
        if (!nsId) {
          // No upgradePolicy: mero-js 13 dropped it from CreateNamespaceRequest
          // (the node applies its default). Matches the fleet's createNamespace.
          const ns = await mero.admin.createNamespace({ applicationId });
          await mero.admin.setDefaultCapabilities(ns.namespaceId, {
            defaultCapabilities: DEFAULT_CAPABILITIES,
          });
          nsId = ns.namespaceId;
        }
        const ctx = await mero.admin.createContext({
          applicationId,
          groupId: nsId,
          serviceName: PRIMARY_SERVICE.name,
          initializationParams: [],
        });
        saveName(ctx.contextId, name);
        setNameVersion((v) => v + 1);
        setExecutorPublicKey(ctx.memberPublicKey);
        setContextId(ctx.contextId);
        setPendingInitName(name); // AppPage runs initProject once ready
        await Promise.all([refetchNamespaces(), refetchContexts()]);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        creatingRef.current = false;
        setBootstrapping(false);
      }
    },
    [mero, applicationId, namespaceId, refetchNamespaces, refetchContexts],
  );

  const invite = useCallback(async () => {
    if (!namespaceId) throw new Error('No workspace yet — create one first.');
    return createNamespaceInvitation(namespaceId, { recursive: true });
  }, [namespaceId, createNamespaceInvitation]);

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
    await Promise.all([refetchNamespaces(), refetchContexts()]);
  }, [joinNamespace, refetchNamespaces, refetchContexts]);

  return {
    workspaces,
    contextId,
    executorPublicKey,
    ready: contextId !== null && executorPublicKey !== null,
    loading: nsLoading || ctxLoading || bootstrapping,
    error,
    openWorkspace,
    createWorkspace,
    pendingInitName,
    clearPendingInit,
    leaveWorkspace,
    invite,
    join,
    inviteLoading,
    joinLoading,
  };
}
