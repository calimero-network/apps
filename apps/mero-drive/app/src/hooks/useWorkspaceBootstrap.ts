// Workspace bootstrap — find (or create) the per-namespace Registry
// context, and ensure the caller is joined to it. Returns the
// registry context id that downstream hooks (useRegistryClient,
// useWorkspaceTree, useReconcile) need.
//
// The Registry context is a single well-known context attached to
// the namespace root group with alias `REGISTRY_CONTEXT_ALIAS`. If
// one already exists (looked up via useGroupContexts), we use it; if
// not, we call useCreateContext with the `registry` service of our
// multi-service bundle and alias it. Joining is idempotent — the
// node ignores join requests for contexts it's already on.

import { useEffect, useRef, useState } from 'react';
import {
  useGroupContexts,
  useCreateContext,
  useJoinContext,
} from '@calimero-network/mero-react';
import {
  getApplicationId,
  REGISTRY_CONTEXT_ALIAS,
  REGISTRY_SERVICE_ID,
} from '../constants/config';

export interface WorkspaceBootstrapResult {
  registryContextId: string | null;
  loading: boolean;
  error: Error | null;
}

export function useWorkspaceBootstrap(
  namespaceId: string | null,
  rootGroupId: string | null,
  selfIdentity: string | null,
): WorkspaceBootstrapResult {
  const { contexts, loading: ctxLoading, error: ctxError } = useGroupContexts(rootGroupId);
  const { createContext } = useCreateContext();
  const { joinContext } = useJoinContext();

  const [state, setState] = useState<WorkspaceBootstrapResult>({
    registryContextId: null,
    loading: true,
    error: null,
  });

  // Guard against re-running the create/join effect while a prior
  // run is mid-flight. Without this, a React Strict-Mode double-mount
  // or a fast re-render (e.g. from useGroupContexts' refetch) would
  // fire two create_context requests in parallel.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!namespaceId || !rootGroupId || !selfIdentity) {
      setState({ registryContextId: null, loading: true, error: null });
      return;
    }
    if (ctxError) {
      setState({ registryContextId: null, loading: false, error: ctxError });
      return;
    }
    if (ctxLoading) {
      setState({ registryContextId: null, loading: true, error: null });
      return;
    }

    const existing = contexts.find((c) => c.alias === REGISTRY_CONTEXT_ALIAS);
    if (existing) {
      // Found it. Ensure we're joined (idempotent on the node side)
      // then surface the id. Join failure is non-fatal — if we're
      // already a member the node returns an error we can ignore.
      let alive = true;
      (async () => {
        await joinContext(existing.contextId).catch(() => undefined);
        if (alive) {
          setState({ registryContextId: existing.contextId, loading: false, error: null });
        }
      })();
      return () => {
        alive = false;
      };
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    let alive = true;
    (async () => {
      try {
        const created = await createContext({
          applicationId: getApplicationId(),
          groupId: rootGroupId,
          serviceName: REGISTRY_SERVICE_ID,
          initializationParams: [],
        });
        if (!alive) return;
        if (!created?.contextId) {
          throw new Error('createContext returned no contextId');
        }
        await joinContext(created.contextId).catch(() => undefined);
        if (alive) {
          setState({ registryContextId: created.contextId, loading: false, error: null });
        }
      } catch (e: unknown) {
        if (alive) {
          const err = e instanceof Error ? e : new Error(String(e));
          setState({ registryContextId: null, loading: false, error: err });
        }
      } finally {
        inFlightRef.current = false;
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    namespaceId,
    rootGroupId,
    selfIdentity,
    contexts,
    ctxLoading,
    ctxError,
    createContext,
    joinContext,
  ]);

  return state;
}
