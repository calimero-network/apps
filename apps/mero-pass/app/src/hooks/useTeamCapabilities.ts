import { useCallback, useEffect, useState } from 'react';

import { useCalimero } from '../calimero';
import { myCapabilities } from '../lib/vaults';

/**
 * This account and its capability mask in one team (an organization): every
 * bit for an owner or admin, the org's default (or the member's own) mask for
 * anyone else. Every "may I?" in this app is asked of the mask (`lib/roles`).
 */
export function useTeamCapabilities(namespaceId: string | null): {
  accountId: string | null;
  capabilities: number | null;
  loading: boolean;
  refetch: () => Promise<void>;
} {
  const { client, accountId, after } = useCalimero();
  const [capabilities, setCapabilities] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const read = useCallback(async () => {
    if (!client || !namespaceId || !accountId) {
      setCapabilities(null);
      setLoading(!!namespaceId);
      return;
    }
    setLoading(true);
    try {
      setCapabilities(await myCapabilities({ client }, namespaceId, accountId));
    } catch {
      setCapabilities(null);
    } finally {
      after();
      setLoading(false);
    }
  }, [client, namespaceId, accountId, after]);

  useEffect(() => {
    void read();
  }, [read]);

  return { accountId, capabilities, loading, refetch: read };
}
