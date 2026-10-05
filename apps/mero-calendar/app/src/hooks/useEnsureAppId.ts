import { useCallback, useRef } from "react";
import { setApplicationId, useMero } from "@calimero-network/mero-react";
import { resolveApplicationId } from "../api/appId";

/**
 * Mero Calendar's own application id, resolved once per mount.
 *
 * On a NODE login the node is asked which of its installed applications is this
 * one (see `api/appId` for why neither the session's id nor a configured one
 * can be trusted unchecked); the id the session was handed is the fallback for
 * when `/applications` cannot be reached at all.
 *
 * On a DELEGATED (account) session there is no node to ask. The listing is
 * node-wide and the relay refuses it to an account's token (403) — and an
 * account has no install of its own to find. Since mero-react 9.11 the
 * provider resolves the account's application id from the registry, by this
 * app's package, so `useMero().applicationId` is the answer there, and the
 * shared-origin worry that rules it out on a node does not apply: it was
 * resolved for THIS app's package, not inherited from whichever app last
 * logged in on this origin.
 *
 * Shared by list/create/join/open so every namespace + context is scoped to the
 * right app.
 */
export function useEnsureAppId(): () => Promise<string> {
  const { admin, isDelegated, applicationId } = useMero();
  const appIdRef = useRef<string>("");

  return useCallback(async (): Promise<string> => {
    if (appIdRef.current) return appIdRef.current;
    let id = "";
    if (!isDelegated && admin) {
      try {
        id = await resolveApplicationId(admin);
      } catch {
        /* the node could not be asked — fall back to the session's id */
      }
    }
    if (!id) id = applicationId ?? "";
    if (id) {
      appIdRef.current = id;
      setApplicationId(id);
    }
    return id;
  }, [admin, isDelegated, applicationId]);
}
