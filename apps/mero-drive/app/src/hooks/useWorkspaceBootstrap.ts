// Workspace bootstrap — find (or create) the per-namespace Registry
// context, and ensure the caller is joined to it. Returns the
// registry context id that downstream hooks (useRegistryClient,
// useWorkspaceTree, useReconcile) need.
//
// Identification strategy: the Registry context is identified by a
// per-rootGroup context alias registered via the admin-API alias
// system (`POST /admin-api/alias/create/context`). On bootstrap we
// first lookup the alias; if it resolves, we join and surface. If
// not, we check for a legacy alias (bare `REGISTRY_CONTEXT_ALIAS` on
// a group-context entry), adopt it if present, and then as a last
// resort create a new context + set the alias atomically enough to
// be durable across reloads.
//
// Admin-API alias names are globally unique on a node, so per-root
// disambiguation has to live in the alias name itself. See
// `aliasNameFor` below.
//
// Joining is idempotent — the node ignores join requests for
// contexts it's already on.

import { useEffect, useRef, useState } from 'react';
import {
  useGroupContexts,
  useCreateContext,
  useJoinContext,
  useDeleteContext,
} from '@calimero-network/mero-react';
import { adminRequest } from '../api/adminApi';
import {
  getApplicationId,
  REGISTRY_CONTEXT_ALIAS,
  REGISTRY_SERVICE_ID,
} from '../constants/config';

// Admin-API alias names are globally unique within a node, not
// scoped by group — so per-rootGroup disambiguation has to live in
// the name itself. Prefixing with the app identifier avoids
// collisions across apps sharing the same node.
const aliasNameFor = (rootGroupId: string) =>
  `mero-drive:${REGISTRY_CONTEXT_ALIAS}:${rootGroupId}`;

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
  const { deleteContext } = useDeleteContext();

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

    const aliasName = aliasNameFor(rootGroupId);

    // Lookup strategy: check whether we've already aliased a Registry
    // context for this rootGroupId. The alias lookup is authoritative
    // across browsers / page reloads (lives on the node), so two tabs
    // or a fresh login converge on the same context.
    let alive = true;
    (async () => {
      try {
        const lookup = await adminRequest<{ value: string }>(
          `/alias/lookup/context/${encodeURIComponent(aliasName)}`,
          { method: 'POST', body: '{}' },
        ).catch(() => null);

        if (lookup?.value) {
          // Alias resolved to an existing contextId. Ensure we're
          // joined (idempotent on the node side) and surface the id.
          await joinContext(lookup.value).catch(() => undefined);
          if (alive) {
            setState({ registryContextId: lookup.value, loading: false, error: null });
          }
          return;
        }

        // Fallback: tolerate contexts created before alias support
        // landed (or by legacy clients) — if the group has a context
        // whose alias matches the bare REGISTRY_CONTEXT_ALIAS, adopt
        // it and set the new per-root alias for future lookups.
        const legacy = contexts.find((c) => c.alias === REGISTRY_CONTEXT_ALIAS);
        if (legacy) {
          await adminRequest(`/alias/create/context`, {
            method: 'POST',
            body: JSON.stringify({ name: aliasName, value: legacy.contextId }),
          }).catch(() => undefined);
          await joinContext(legacy.contextId).catch(() => undefined);
          if (alive) {
            setState({ registryContextId: legacy.contextId, loading: false, error: null });
          }
          return;
        }

        // Create path — guarded against Strict-Mode double-mount and
        // fast useGroupContexts refetches so two parallel create_context
        // calls can't leak duplicate Registry contexts in the same
        // React instance. Cross-tab races are handled below via
        // post-create alias re-lookup.
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        try {
          const created = await createContext({
            applicationId: getApplicationId(),
            groupId: rootGroupId,
            serviceName: REGISTRY_SERVICE_ID,
            initializationParams: [],
          });
          // Intentionally no `if (!alive) return` here: the context
          // exists server-side once createContext resolves, so we must
          // finish either aliasing it (so a future effect adopts it)
          // or deleting it on the cleanup path. Bailing early without
          // either would orphan the context. setState calls below are
          // already guarded by `alive`.
          if (!created?.contextId) {
            throw new Error('createContext returned no contextId');
          }
          // Optimistic alias set. If this tab wins the race, the
          // alias resolves to our new contextId. If another tab's
          // create landed between our lookup and alias-set, this
          // call fails (alias name already exists) and we fall
          // through to the re-lookup branch below to adopt the
          // winner and clean up our leaked context.
          const aliasCreated = await adminRequest(`/alias/create/context`, {
            method: 'POST',
            body: JSON.stringify({ name: aliasName, value: created.contextId }),
          }).then(() => true).catch((err) => {
            console.warn('registry alias create failed — will reconcile', err);
            return false;
          });

          if (!aliasCreated) {
            // alias-create said "failed." Two causes: (a) another
            // tab's create landed first so the name is taken, or
            // (b) our POST succeeded server-side but the HTTP
            // response was lost. Re-lookup disambiguates.
            const reLookup = await adminRequest<{ value: string }>(
              `/alias/lookup/context/${encodeURIComponent(aliasName)}`,
              { method: 'POST', body: '{}' },
            ).catch(() => null);

            if (reLookup?.value === created.contextId) {
              // Response-loss case: the alias actually got set to
              // OUR contextId; we just didn't see the 2xx. Proceed
              // as if aliasCreated had been true. Do NOT delete the
              // context — the alias points at it and a delete here
              // would leave a dangling alias mapping.
              await joinContext(created.contextId).catch(() => undefined);
              if (alive) {
                setState({ registryContextId: created.contextId, loading: false, error: null });
              }
              return;
            }

            if (reLookup?.value) {
              // Another tab won the race (alias resolves to a
              // different contextId). Delete our orphan and adopt
              // theirs.
              await deleteContext(created.contextId).catch((err) =>
                console.warn('failed to clean up racing-loss context', err),
              );
              await joinContext(reLookup.value).catch(() => undefined);
              if (alive) {
                setState({ registryContextId: reLookup.value, loading: false, error: null });
              }
              return;
            }

            // Alias didn't resolve at all — genuine failure. Delete
            // our orphaned context so reboots don't accumulate
            // leaks, then surface the error.
            await deleteContext(created.contextId).catch((err) =>
              console.warn('failed to clean up orphaned context', err),
            );
            if (alive) {
              setState({
                registryContextId: null,
                loading: false,
                error: new Error(
                  'Could not alias Registry context — workspace bootstrap aborted to avoid leaking contexts',
                ),
              });
            }
            return;
          }

          await joinContext(created.contextId).catch(() => undefined);
          if (alive) {
            setState({ registryContextId: created.contextId, loading: false, error: null });
          }
        } finally {
          inFlightRef.current = false;
        }
      } catch (e: unknown) {
        if (alive) {
          const err = e instanceof Error ? e : new Error(String(e));
          setState({ registryContextId: null, loading: false, error: err });
        }
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
    deleteContext,
  ]);

  return state;
}
