import { useEffect, useState } from 'react';
import { useMero } from '@calimero-apps/cloud';
import { resolveApplicationId } from '../lib/appId';

/**
 * This app's application id on the connected node.
 *
 * Asked of the node and matched by package — see `lib/appId`. Deliberately not
 * the session's or the provider's id on a node: those describe how you arrived,
 * and on a shared origin they belong to whichever app logged in last.
 *
 * On an account (delegated) session there is no node to ask: the listing is
 * `GET /admin-api/applications`, node-wide, which a relay refuses to an
 * account (403). There the provider resolves the id from the registry by this
 * app's package, so `useMero().applicationId` is the answer, and it lands
 * AFTER sign-in. Until it does the id is still being resolved, not absent:
 * reporting "not installed" (or listing nothing and offering to create) would
 * tell an account that has workspaces it has none.
 *
 * Cached per node URL for the lifetime of the page. The answer only changes when
 * this app is installed or removed, which is not something a picker needs to
 * poll for, and re-asking on every mount makes the workspace list flicker
 * between empty and populated on each navigation.
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
  // `admin`, not `mero.admin`: the session-aware client. On an account the
  // listing is never asked for (below).
  const { admin, nodeUrl, isDelegated, applicationId } = useMero();
  const key = nodeUrl ?? '';
  const [appId, setAppId] = useState<string>(() => cache.get(key) ?? '');
  const [resolving, setResolving] = useState(() => !cache.has(key));

  useEffect(() => {
    if (isDelegated || !admin) return;
    const cached = cache.get(key);
    if (cached !== undefined) {
      setAppId(cached);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    void resolveApplicationId(admin).then((id) => {
      if (cancelled) return;
      cache.set(key, id);
      setAppId(id);
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [admin, key, isDelegated]);

  if (isDelegated) {
    const id = applicationId ?? '';
    return { appId: id, resolving: !id, notInstalled: false };
  }
  return { appId, resolving, notInstalled: !resolving && !appId };
}

/** Test seam: drop the memoised answer so a fresh resolve runs. */
export function clearApplicationIdCache(): void {
  cache.clear();
}
