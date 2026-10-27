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
 *
 * On a delegated (account) session there is no node to ask. The listing is
 * `GET /admin-api/applications`, node-wide, which the relay refuses to an
 * account's token (403) — and an account has no install of its own to find.
 * Since mero-react 9.11 the provider resolves the account's application id
 * from the registry, by this app's package, so `useMero().applicationId` is
 * the answer there, and the shared-origin worry that rules it out on a node
 * does not apply: it was resolved for THIS app's package, not inherited from
 * whichever app last logged in.
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
  // `admin`, not `mero.admin`: the session-aware client (apps#348). On a node
  // it is the node's own; on an account the list is never asked for (below).
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
    return () => { cancelled = true; };
  }, [admin, key, isDelegated]);

  if (isDelegated) {
    // The registry's answer for this package. Until the provider has it the id
    // is "" and `notInstalled` stays false: an account is never "not
    // installed", it just has not been told yet.
    const id = applicationId ?? '';
    return { appId: id, resolving: false, notInstalled: false };
  }

  return { appId, resolving, notInstalled: !resolving && !appId };
}

/** Test seam: drop the memoised answer so a fresh resolve runs. */
export function clearApplicationIdCache(): void {
  cache.clear();
}
