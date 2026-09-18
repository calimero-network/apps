import { useCallback, useEffect, useState } from 'react';
import { useMero, useNodeIdentity } from '@calimero-network/mero-react';

import { myCapabilities } from '../lib/vaults';

/**
 * This node's own ACCOUNT and its real capability mask in one space.
 *
 * ⚠️ `useNodeIdentity().identity.accountId`, never `publicKey` and never a
 * context executor identity. All three are 64 hex since rc.27, so a swap
 * type-checks, sends, returns 200 and asks about a principal that exists
 * nowhere — the mask comes back as if the caller had no permissions, or as a
 * silent `null`, and every gate in the UI closes for no visible reason.
 *
 * Returns the MASK, not a role string, because the mask is what the node
 * enforces. Every "may I?" in this app is asked of it — see `lib/roles`.
 */
export function useSpaceCapabilities(namespaceId: string | null): {
  /** This node's account, 64 hex, or null before the identity has resolved. */
  accountId: string | null;
  capabilities: number | null;
  loading: boolean;
  refetch: () => Promise<void>;
} {
  const { mero } = useMero();
  const { identity } = useNodeIdentity();
  const accountId = identity?.accountId ?? null;
  const [capabilities, setCapabilities] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const read = useCallback(async () => {
    if (!mero || !namespaceId || !accountId) {
      setCapabilities(null);
      setLoading(!!namespaceId);
      return;
    }
    setLoading(true);
    setCapabilities(await myCapabilities(mero.admin, namespaceId, accountId));
    setLoading(false);
  }, [mero, namespaceId, accountId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await read();
    })();
    return () => {
      cancelled = true;
    };
  }, [read]);

  return { accountId, capabilities, loading, refetch: read };
}
