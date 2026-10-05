import { useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { resolveApplicationId } from '../lib/appId';

/**
 * This app's application id on the connected node.
 *
 * Asked of the node and matched by package — see `lib/appId`. Deliberately not
 * the session's or the provider's id: those describe how you arrived, and on a
 * shared origin they belong to whichever app logged in last.
 *
 * Cached per node URL for the lifetime of the page. The answer only changes when
 * this app is installed or removed, which is not something a picker needs to
 * poll for, and re-asking on every mount made the vault list flicker between
 * empty and populated on each navigation.
 *
 * ── On an ACCOUNT (a delegated session through a relay) ────────────────────
 *
 * There is no node to ask. `GET /admin-api/applications` is a node-wide
 * listing that the relay refuses to an account's token (403), and an account
 * has no install of its own to find. Since mero-react 9.11 the provider
 * resolves the account's application id from the REGISTRY, by this app's
 * package, and hands it out as `useMero().applicationId` — so that is the
 * answer there, and the shared-origin worry above does not apply to it: it
 * was resolved for THIS app's package, not inherited from the last login.
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
  // `admin`, not `mero.admin`: the session-aware client. On a node it is the
  // node's own; on an account the listing is never asked for (below).
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
    resolveApplicationId(admin).then((id) => {
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
    // The registry's answer for this package. Until the provider has it the
    // id is "", which is "not yet", never "not installed": an account is not
    // installed anywhere, so that verdict would be meaningless and would hide
    // the create controls behind a message that cannot be acted on.
    return {
      appId: applicationId ?? '',
      resolving: false,
      notInstalled: false,
    };
  }

  return { appId, resolving, notInstalled: !resolving && !appId };
}

/** Test seam: drop the memoised answer so a fresh resolve runs. */
export function clearApplicationIdCache(): void {
  cache.clear();
}
