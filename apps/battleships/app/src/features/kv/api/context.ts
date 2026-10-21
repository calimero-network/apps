import type { AdminApiClient } from '@calimero-network/mero-js';

/**
 * The two reads a context lookup needs, from the SESSION admin
 * (`useMero().admin`), not `mero.admin`. On an account `mero.admin` is the
 * relay's raw node client: its `getContextIdentitiesOwned` is the relay's own
 * identities, not the account's. The session admin answers with the account.
 */
export type ContextAdmin = Pick<AdminApiClient, 'getContexts' | 'getContextIdentitiesOwned'>;

export interface AppContext {
  applicationId: string;
  contextId: string;
  executorPublicKey: string;
}

/**
 * Specifies which kind of context the caller intends to resolve.
 * - `lobby`  – the canonical open Lobby context for the selected group.
 * - `match`  – a specific per-game Match context (requires `targetContextId`).
 */
export type ContextRole = 'lobby' | 'match';

export interface ResolveAppContextOptions {
  /** Explicit context id to target. Required for `match` role. */
  targetContextId?: string | null;
  /** Executor identity supplied by the auth flow. */
  contextIdentity?: string | null;
  /** The role of the context being resolved. */
  role?: ContextRole | null;
  /** Application id used to filter contexts when resolving a lobby. */
  applicationId?: string | null;
}

interface MeroContextRecord {
  id: string;
  applicationId: string;
}

function requireTargetContext(
  contexts: MeroContextRecord[],
  targetContextId: string,
): MeroContextRecord {
  const targetContext = contexts.find((context) => context.id === targetContextId);
  if (!targetContext) {
    throw new Error('The requested context is not available on this node.');
  }
  return targetContext;
}

async function resolveIdentity(
  admin: ContextAdmin,
  contextId: string,
  contextIdentity?: string | null,
): Promise<string> {
  if (contextIdentity) {
    return contextIdentity;
  }

  const { identities } = await admin.getContextIdentitiesOwned(contextId);
  const executorPublicKey = identities[0];

  if (!executorPublicKey) {
    throw new Error('No context identity is available for the selected context.');
  }

  return executorPublicKey;
}

export async function resolveAppContext(
  admin: ContextAdmin,
  options: ResolveAppContextOptions = {},
): Promise<AppContext> {
  const role = options.role ?? null;

  if (role === 'match') {
    if (!options.targetContextId) {
      throw new Error('A target context id is required when resolving a match context.');
    }

    const { contexts } = await admin.getContexts();
    const selected = requireTargetContext(contexts, options.targetContextId);
    const executorPublicKey = await resolveIdentity(admin, selected.id, options.contextIdentity);

    return {
      applicationId: selected.applicationId,
      contextId: selected.id,
      executorPublicKey,
    };
  }

  if (role === 'lobby') {
    if (!options.targetContextId) {
      throw new Error('A target context id is required when resolving a lobby context.');
    }

    const { contexts } = await admin.getContexts();
    const selected = requireTargetContext(contexts, options.targetContextId);
    const executorPublicKey = await resolveIdentity(admin, selected.id, options.contextIdentity);

    return {
      applicationId: selected.applicationId,
      contextId: selected.id,
      executorPublicKey,
    };
  }

  if (options.targetContextId) {
    const { contexts } = await admin.getContexts();
    const selected = requireTargetContext(contexts, options.targetContextId);
    const executorPublicKey = await resolveIdentity(admin, selected.id, options.contextIdentity);

    return {
      applicationId: selected.applicationId,
      contextId: selected.id,
      executorPublicKey,
    };
  }

  throw new Error(
    'No context intent provided. Specify a role and target context id, or provide an explicit target context id.',
  );
}
