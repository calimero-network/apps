import { useCallback, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

/**
 * Capability bits for the battleships namespace.
 *
 * CAN_CREATE_CONTEXT (1) — members can create match contexts in subgroups
 * CAN_INVITE_MEMBERS (2) — members can invite other players
 * MANAGE_MEMBERS     (8) — members can add opponents to match subgroups
 */
const BATTLESHIPS_DEFAULT_CAPABILITIES = 1 | 2 | 8; // = 11

export interface NamespaceBootstrapResult {
  namespaceId: string;
  lobbyContextId: string;
  memberPublicKey: string;
}

export interface UseNamespaceBootstrapReturn {
  /** Rejects with the reason on failure (also kept in `error`). */
  createNamespaceWithLobby: (alias?: string) => Promise<NamespaceBootstrapResult>;
  loading: boolean;
  error: Error | null;
}

export function useNamespaceBootstrap(
  applicationId: string | null,
): UseNamespaceBootstrapReturn {
  // The session admin, not `mero.admin`. On an account `mero` is the relay
  // client, and its admin routes are the relay's own node routes, which refuse
  // an account (403): the lobby could never be created. `admin` is the node's
  // client on a node login and the account admin on an account, which founds
  // the namespace and creates the lobby context as delegated ops.
  const { admin } = useMero();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createNamespaceWithLobby = useCallback(
    async (alias?: string): Promise<NamespaceBootstrapResult> => {
      setError(null);
      if (!admin || !applicationId) {
        // Not created without one: a namespace bound to no application is a
        // lobby this app can never list again. On an account the id lands from
        // the registry shortly after sign-in.
        const e = new Error('Still connecting. Try again in a moment.');
        setError(e);
        throw e;
      }

      setLoading(true);

      try {
        // 1. Create namespace (root group bound to the battleships application)
        const ns = await admin.createNamespace({
          applicationId,
          name: alias,
        });

        const namespaceId = ns.namespaceId;

        // 2. Configure default capabilities so all members can create matches
        await admin.setDefaultCapabilities(namespaceId, {
          defaultCapabilities: BATTLESHIPS_DEFAULT_CAPABILITIES,
        });

        // 3. Create the lobby context inside the namespace root group
        const ctx = await admin.createContext({
          applicationId,
          groupId: namespaceId,
          serviceName: 'lobby',
          initializationParams: [],
        });

        return {
          namespaceId,
          lobbyContextId: ctx.contextId,
          memberPublicKey: ctx.memberPublicKey,
        };
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [admin, applicationId],
  );

  return { createNamespaceWithLobby, loading, error };
}
