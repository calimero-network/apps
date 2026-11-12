import { useEffect, useMemo, useState } from 'react';

import { useCalimero } from '../calimero';
import { MeroPassClient } from '../generated/client';

/**
 * One vault's typed contract, or null until signed in. A vault is an app
 * instance this account reaches; there is no per-context identity to resolve
 * first (v1's `getContextIdentitiesOwned`): the caller is the account.
 */
export function useVaultClient(contextId: string | null): MeroPassClient | null {
  const { client, isAuthenticated, after } = useCalimero();
  return useMemo(
    () =>
      client && isAuthenticated && contextId
        ? new MeroPassClient(client, contextId, { after })
        : null,
    [client, isAuthenticated, contextId, after],
  );
}

/** The last-resort label for a vault: its instance id, shortened. */
export function vaultLabel(contextId: string): string {
  return `Vault ${contextId.slice(0, 8)}…`;
}

/** A vault's name, read from the contract; the short id until it answers. */
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
        if (!cancelled) setName('');
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return name || (contextId ? vaultLabel(contextId) : 'Vault');
}
