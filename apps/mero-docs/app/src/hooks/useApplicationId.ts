// mero-docs's application id on the connected node.
//
// Asked of the node and matched by package — see `lib/appId` for why the
// session's id and `VITE_APPLICATION_ID` are both the wrong answer.
//
// Cached per node URL for the lifetime of the page: the answer only changes
// when this app is installed or removed on that node, which is not something
// the workspace list needs to poll for, and re-asking on every mount makes the
// namespace list flicker between empty and populated.

import { useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { resolveApplicationId } from '@/lib/appId';

interface CacheEntry {
  id: string;
  packageAware: boolean;
}

const cache = new Map<string, CacheEntry>();

export interface ApplicationIdState {
  /** The id, or `''` once resolution has finished and found nothing. */
  appId: string;
  /** True until the node has answered. Distinguishes "asking" from "absent". */
  resolving: boolean;
  /** Resolution finished, the node knows packages, and this app is not installed. */
  notInstalled: boolean;
  /**
   * The node answered with no package on any row (a raw-wasm dev install, or the
   * list call failed). `appId` is then `''` because we could not tell, not
   * because the app is absent — the caller should fall back rather than refuse.
   */
  inconclusive: boolean;
}

export function useApplicationId(): ApplicationIdState {
  const { mero, nodeUrl } = useMero();
  const key = nodeUrl ?? '';
  const [entry, setEntry] = useState<CacheEntry | null>(
    () => cache.get(key) ?? null,
  );
  const [resolving, setResolving] = useState(() => !cache.has(key));

  useEffect(() => {
    if (!mero) return;
    const cached = cache.get(key);
    if (cached !== undefined) {
      setEntry(cached);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    void resolveApplicationId(mero.admin).then((resolved) => {
      if (cancelled) return;
      cache.set(key, resolved);
      setEntry(resolved);
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mero, key]);

  const id = entry?.id ?? '';
  const packageAware = entry?.packageAware ?? false;
  return {
    appId: id,
    resolving,
    notInstalled: !resolving && !id && packageAware,
    inconclusive: !resolving && !id && !packageAware,
  };
}

/** Test seam: drop the memoised answer so a fresh resolve runs. */
export function clearApplicationIdCache(): void {
  cache.clear();
}
