/**
 * useItems — neutral CRUD over the single-context `service` registry.
 *
 * The canonical Calimero data-binding pattern (mero-react v4):
 *  - `useWorkspace()` resolves the shared context + the executor identity to
 *    sign RPC calls with (from the auth callback on desktop, or the bootstrapped
 *    context on web).
 *  - a typed generated client (`ServiceClient`) wraps `mero.rpc.execute`.
 *  - `useSubscription([contextId])` re-fetches on every sync event, so changes
 *    from other peers appear live with no polling.
 *
 * The build agent reshapes `Item` + these methods to the spec's entity; the
 * wiring (client memo, subscription refresh, optimistic refetch) stays.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';
import { ServiceClient, Item } from '../api/service/ServiceClient';

export interface UseItemsArgs {
  contextId: string | null;
  executorPublicKey: string | null;
}

export interface UseItemsReturn {
  items: Item[];
  loading: boolean;
  error: Error | null;
  ready: boolean;
  add: (title: string, body: string) => Promise<void>;
  update: (id: string, title: string, body: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useItems({ contextId, executorPublicKey }: UseItemsArgs): UseItemsReturn {
  const { mero } = useMero();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Memoized typed client — null until the context + identity resolve.
  const client = useMemo(
    () =>
      mero && contextId && executorPublicKey
        ? new ServiceClient(mero, contextId, executorPublicKey)
        : null,
    [mero, contextId, executorPublicKey],
  );

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await client.list());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Live updates: re-fetch on any sync event for this context (local or remote).
  useSubscription(contextId ? [contextId] : [], () => { void refresh(); });

  const add = useCallback(async (title: string, body: string) => {
    if (!client) return;
    await client.add({ title, body });
    await refresh();
  }, [client, refresh]);

  const update = useCallback(async (id: string, title: string, body: string) => {
    if (!client) return;
    await client.update({ id, title, body });
    await refresh();
  }, [client, refresh]);

  const remove = useCallback(async (id: string) => {
    if (!client) return;
    await client.delete({ id });
    await refresh();
  }, [client, refresh]);

  return {
    items,
    loading,
    error,
    ready: client !== null,
    add,
    update,
    remove,
    refresh,
  };
}
