import { useEffect, useMemo, useState } from "react";
import { useMero } from "@calimero-network/mero-react";

import { MeroPassClient } from "../generated/MeroPassClient";

/**
 * The contexts this node holds. A Calimero context IS a vault — there is no
 * separate vault record in the contract.
 *
 * Replaces a hand-rolled `app.fetchContexts()` that then guessed at the
 * response shape three ways over (`data.contexts`, `contexts`, or the value
 * itself) and read an id from either `id` or `contextId`. mero-js answers one
 * shape, so the guessing is gone.
 */
export function useVaultContexts(): {
  contextIds: string[];
  loading: boolean;
  error: string | null;
} {
  const { mero } = useMero();
  const [contextIds, setContextIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mero) return;
    let cancelled = false;
    setLoading(true);
    mero.admin
      .getContexts()
      .then((resp) => {
        if (cancelled) return;
        setContextIds((resp.contexts ?? []).map((c) => c.id));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mero]);

  return { contextIds, loading, error };
}

/**
 * A typed client for one vault, imperatively.
 *
 * The list page needs one client PER context, and a hook cannot be called in a
 * loop — so the shared resolution lives here and `useVaultClient` wraps it for
 * the single-vault case.
 */
export async function clientForContext(
  mero: NonNullable<ReturnType<typeof useMero>["mero"]>,
  contextId: string,
): Promise<MeroPassClient | null> {
  const { identities } = await mero.admin.getContextIdentitiesOwned(contextId);
  if (identities.length === 0) return null;
  return new MeroPassClient(mero, contextId, identities[0]);
}

/**
 * A typed client for one vault, or null until both the node and this node's
 * identity IN that context have resolved.
 *
 * ⚠️ The executor is the identity this node OWNS in the context, read from
 * `getContextIdentitiesOwned` — not the account id. They are both 64 hex
 * characters since rc.27, so passing the wrong one type-checks, sends, and is
 * rejected as an unauthorized signer rather than as a bad argument.
 */
export function useVaultClient(contextId: string | null): MeroPassClient | null {
  const { mero } = useMero();
  const [executor, setExecutor] = useState<string | null>(null);

  useEffect(() => {
    if (!mero || !contextId) {
      setExecutor(null);
      return;
    }
    let cancelled = false;
    mero.admin
      .getContextIdentitiesOwned(contextId)
      .then(({ identities }) => {
        if (!cancelled && identities.length > 0) setExecutor(identities[0]);
      })
      .catch(() => {
        if (!cancelled) setExecutor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mero, contextId]);

  return useMemo(
    () =>
      mero && contextId && executor
        ? new MeroPassClient(mero, contextId, executor)
        : null,
    [mero, contextId, executor],
  );
}

/** A vault's display name. Contexts carry no name in this app. */
export function vaultLabel(contextId: string): string {
  return `Vault ${contextId.slice(0, 8)}…`;
}
