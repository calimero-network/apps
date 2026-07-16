/**
 * useWorkspace — resolves the ONE shared Calimero context this single-context
 * app runs in, and exposes invite / join so peers can collaborate in it.
 *
 * Single-context model (the neutral foundation):
 *  - The app installs as a Calimero application → a namespace. The shared state
 *    lives in one context inside that namespace, created from `PRIMARY_SERVICE`.
 *  - When launched from the desktop app (SSO), `useMero()` already carries a
 *    `contextId` + `contextIdentity` from the auth callback — we use those
 *    directly and skip bootstrap.
 *  - On the web, first run has no context: we create the namespace + context
 *    once and remember it. Peers join via a namespace invitation (Invite/Join
 *    modals) — no rooms, no per-instance contexts.
 *
 * The build agent rarely touches this: it reshapes the DATA hook (`useItems`)
 * and the page, not the workspace wiring. Multi-context specs replace this with
 * the per-context topology documented in the calimero-client-js skill.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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

// Stable name for this app's one shared context, registered in the node's
// alias registry so tools (e.g. the MCP server) can resolve it by name.
const WORKSPACE_ALIAS = 'issue-tracker';

export interface UseWorkspaceReturn {
  /** The shared context's id — null until resolved/created. Feeds useItems. */
  contextId: string | null;
  /** Executor public key for that context (the signer for RPC calls). */
  executorPublicKey: string | null;
  /** True once a context exists and we hold an executor identity for it. */
  ready: boolean;
  loading: boolean;
  error: Error | null;
  /** Create the namespace + shared context (first-run web bootstrap). */
  bootstrap: () => Promise<void>;
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

  // The namespace this app operates in. Resolve it from the bound context
  // (a context's group IS its namespace) so invite() targets the right
  // namespace even when the node hosts several, falling back to the first
  // discovered namespace before a context resolves. Production single-context
  // launches resolve to the same value the old `namespaces[0]` gave.
  const [nsForContext, setNsForContext] = useState<string | null>(null);
  const namespaceId = nsForContext ?? namespaces[0]?.namespaceId ?? null;

  // Contexts inside that namespace; the shared context is the first one.
  const { contexts: nsContexts, loading: ctxLoading, refetch: refetchContexts } =
    useGroupContexts(namespaceId);

  const [contextId, setContextId] = useState<string | null>(callbackContextId);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(
    callbackContextIdentity,
  );
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Prefer the auth-callback context (desktop SSO) over the discovered one.
  useEffect(() => {
    if (callbackContextId) {
      setContextId(callbackContextId);
      if (callbackContextIdentity) setExecutorPublicKey(callbackContextIdentity);
      return;
    }
    if (nsContexts.length > 0) setContextId(nsContexts[0].contextId);
  }, [callbackContextId, callbackContextIdentity, nsContexts]);

  // Resolve the executor identity we own in the resolved context.
  useEffect(() => {
    if (!mero || !contextId || executorPublicKey) return;
    let cancelled = false;
    (async () => {
      try {
        const { identities } = await mero.admin.getContextIdentitiesOwned(contextId);
        if (!cancelled && identities.length > 0) setExecutorPublicKey(identities[0]);
      } catch {
        /* leave null — useItems stays not-ready until an identity resolves */
      }
    })();
    return () => { cancelled = true; };
  }, [mero, contextId, executorPublicKey]);

  // Register the well-known `issue-tracker` context alias once a context
  // exists. Best-effort and one-shot per context: a missing alias (lookup
  // 404s) gets created; any other failure (network, older node) is swallowed -
  // the alias is a convenience for external tools, never a requirement.
  const aliasEnsuredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mero || !contextId || aliasEnsuredRef.current === contextId) return;
    aliasEnsuredRef.current = contextId;
    (async () => {
      try {
        const looked = await mero.admin.lookupContextAlias(WORKSPACE_ALIAS);
        if (looked?.value) return;
        await mero.admin.createContextAlias({ alias: WORKSPACE_ALIAS, contextId });
      } catch {
        try {
          await mero.admin.createContextAlias({ alias: WORKSPACE_ALIAS, contextId });
        } catch {
          /* alias is a convenience only - never blocks the workspace */
        }
      }
    })();
  }, [mero, contextId]);

  // Resolve the bound context's namespace (its group) so invite() targets it
  // regardless of how many namespaces the node hosts. Falls back to
  // namespaces[0] when it can't resolve (older nodes / pre-context).
  useEffect(() => {
    if (!mero || !contextId) { setNsForContext(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const gid = await mero.admin.getContextGroup(contextId);
        if (!cancelled && gid) setNsForContext(gid);
      } catch {
        /* fall back to namespaces[0] */
      }
    })();
    return () => { cancelled = true; };
  }, [mero, contextId]);

  const bootstrappedRef = useRef(false);
  const bootstrap = useCallback(async () => {
    if (!mero || !applicationId || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    setBootstrapping(true);
    setError(null);
    try {
      const ns = await mero.admin.createNamespace({
        applicationId,
        upgradePolicy: 'Automatic',
      });
      await mero.admin.setDefaultCapabilities(ns.namespaceId, {
        defaultCapabilities: DEFAULT_CAPABILITIES,
      });
      const ctx = await mero.admin.createContext({
        applicationId,
        groupId: ns.namespaceId,
        serviceName: PRIMARY_SERVICE.name,
        initializationParams: [],
      });
      setContextId(ctx.contextId);
      setExecutorPublicKey(ctx.memberPublicKey);
      await refetchNamespaces();
    } catch (err) {
      bootstrappedRef.current = false;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBootstrapping(false);
    }
  }, [mero, applicationId, refetchNamespaces]);

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
    contextId,
    executorPublicKey,
    ready: contextId !== null && executorPublicKey !== null,
    loading: nsLoading || ctxLoading || bootstrapping,
    error,
    bootstrap,
    invite,
    join,
    inviteLoading,
    joinLoading,
  };
}
