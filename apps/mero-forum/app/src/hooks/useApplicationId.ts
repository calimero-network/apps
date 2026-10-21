import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { resolveApplicationId } from "../lib/appId";

/**
 * This app's application id on the connected node.
 *
 * Asked of the node and matched by package — see `lib/appId`. Deliberately not
 * the session's or the provider's id: those describe how you arrived, and on a
 * shared origin they belong to whichever app logged in last.
 *
 * Cached per node URL for the lifetime of the page. The answer only changes when
 * this app is installed or removed, which is not something a picker needs to
 * poll for, and re-asking on every mount made the stream list flicker between
 * empty and populated on each navigation.
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
  const { mero, admin, nodeUrl, isDelegated, applicationId } = useMero();
  const key = nodeUrl ?? "";
  const [appId, setAppId] = useState<string>(() => cache.get(key) ?? "");
  const [resolving, setResolving] = useState(() => !cache.has(key));

  useEffect(() => {
    // An account has no node to ask: `listApplications` is node-wide and a
    // relay refuses it. The provider's registry-derived id is the answer there.
    if (isDelegated || !mero || !admin) return;
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
  }, [mero, admin, isDelegated, key]);

  // On an account the id lands from the registry AFTER sign-in. Until then it
  // is "still resolving", never "not installed": nothing is listed or created
  // under no id, and an empty list meanwhile is not "no spaces".
  if (isDelegated) {
    const id = applicationId ?? "";
    return { appId: id, resolving: !id, notInstalled: false };
  }
  return { appId, resolving, notInstalled: !resolving && !appId };
}

/** Test seam: drop the memoised answer so a fresh resolve runs. */
export function clearApplicationIdCache(): void {
  cache.clear();
}
