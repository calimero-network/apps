import { useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { resolveApplicationId } from '../utils/appId';

/**
 * This app's application id on the connected node.
 *
 * Asked of the node and matched by package — see `utils/appId` for why neither
 * the session's id nor a baked env var can answer this.
 *
 * Cached per node URL for the lifetime of the page. The answer only changes when
 * this app is installed or removed on that node, which is not something a
 * workspace list needs to poll for, and re-asking on every mount made the list
 * flicker between empty and populated on each navigation.
 */
const cache = new Map<string, string>();

export interface ResolvedAppId {
  /** The id, or "" once resolution has finished and found nothing. */
  appId: string;
  /** True until the node has answered. Distinguishes "asking" from "absent". */
  resolving: boolean;
  /** Resolution finished and this app is not installed on the node. */
  notInstalled: boolean;
}

export function useApplicationId(): ResolvedAppId {
  const { mero, nodeUrl } = useMero();
  const key = nodeUrl ?? '';
  const [appId, setAppId] = useState<string>(() => cache.get(key) ?? '');
  const [resolving, setResolving] = useState(() => !cache.has(key));

  useEffect(() => {
    if (!mero) return;
    const cached = cache.get(key);
    if (cached !== undefined) {
      setAppId(cached);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    void resolveApplicationId(mero.admin).then((id) => {
      if (cancelled) return;
      cache.set(key, id);
      setAppId(id);
      setResolving(false);
    });
    return () => { cancelled = true; };
  }, [mero, key]);

  return { appId, resolving, notInstalled: !resolving && !appId };
}

/** Test seam: drop the memoised answer so a fresh resolve runs. */
export function clearApplicationIdCache(): void {
  cache.clear();
}
