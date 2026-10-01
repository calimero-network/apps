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
  const { mero, nodeUrl } = useMero();
  const key = nodeUrl ?? "";
  const [appId, setAppId] = useState<string>(() => cache.get(key) ?? "");
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
    resolveApplicationId(mero.admin).then((id) => {
      if (cancelled) return;
      cache.set(key, id);
      setAppId(id);
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mero, key]);

  return { appId, resolving, notInstalled: !resolving && !appId };
}

/** Test seam: drop the memoised answer so a fresh resolve runs. */
export function clearApplicationIdCache(): void {
  cache.clear();
}
