import { useEffect, useMemo, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

import { MeroPassClient } from '../generated/MeroPassClient';
import type { VaultMero } from './vaults';

/**
 * A typed client for one vault, imperatively.
 *
 * A list page needs one client PER context, and a hook cannot be called in a
 * loop — so the shared resolution lives here and `useVaultClient` wraps it for
 * the single-vault case.
 *
 * Takes the session-aware `admin` and the raw client's `rpc` apart (see
 * `VaultMero`): on an account they are two objects, and the raw client's own
 * admin would answer 403 to the identity read.
 */
export async function clientForContext(
  session: VaultMero,
  contextId: string,
): Promise<MeroPassClient | null> {
  const { identities } =
    await session.admin.getContextIdentitiesOwned(contextId);
  if (identities.length === 0) return null;
  return new MeroPassClient(session.rpc, contextId);
}

/**
 * A typed client for one vault, or null until both the node and this node's
 * identity IN that context have resolved.
 *
 * ⚠️ The executor is the identity this node OWNS in the context, read from
 * `getContextIdentitiesOwned` — not the account id. They are both 64 hex
 * characters since rc.27, so passing the wrong one type-checks, sends, and is
 * rejected as an unauthorized signer rather than as a bad argument.
 *
 * On an account the same read goes through the account admin, which answers
 * caller-scoped: the identities this ACCOUNT holds in the context. The raw
 * client's admin is never asked — it is the relay's node route and refuses.
 */
export function useVaultClient(
  contextId: string | null,
): MeroPassClient | null {
  const { mero, admin } = useMero();
  const [executor, setExecutor] = useState<string | null>(null);

  useEffect(() => {
    if (!admin || !contextId) {
      setExecutor(null);
      return;
    }
    let cancelled = false;
    admin
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
  }, [admin, contextId]);

  return useMemo(
    () =>
      mero && contextId && executor
        ? new MeroPassClient(mero.rpc, contextId)
        : null,
    [mero, contextId, executor],
  );
}

/**
 * The last-resort label for a vault: its context id, shortened.
 *
 * ⚠️ This used to be the ONLY label a vault ever had, which is the bug the
 * named-vault work fixes. It is reached now only while the contract read is in
 * flight, or for a context created before `init` took a name. Anything else
 * should be showing `useVaultName`'s answer.
 */
export function vaultLabel(contextId: string): string {
  return `Vault ${contextId.slice(0, 8)}…`;
}

/**
 * A vault's name, read from replicated CONTRACT state.
 *
 * This is the copy that works on both nodes. `createVault` writes the name
 * three times over (namespace-scoped metadata, the subgroup's metadata record,
 * and `init`'s parameters); the metadata record is what a team member sees
 * before they enter a vault, and this — the contract — is the authoritative
 * answer once they are in it.
 *
 * Falls back to the short id rather than to empty, because a blank heading on
 * a vault page reads as a failed load.
 */
export function useVaultName(contextId: string | null): string {
  const client = useVaultClient(contextId);
  const [name, setName] = useState<string>('');

  useEffect(() => {
    if (!client) {
      setName('');
      return;
    }
    let cancelled = false;
    client
      .vaultName()
      .then((value) => {
        if (!cancelled) setName((value ?? '').trim());
      })
      .catch(() => {
        // A context from before named vaults, or a node that has not
        // replicated the state yet. The short id is still a usable heading.
        if (!cancelled) setName('');
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return name || (contextId ? vaultLabel(contextId) : 'Vault');
}
