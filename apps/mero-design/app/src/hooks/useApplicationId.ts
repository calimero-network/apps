import { useCallback, useRef } from "react";
import { setApplicationId, useMero } from "@calimero-network/mero-react";
import { resolveApplicationId } from "../api/appId";

/**
 * MeroDesign's own application id, resolved once per mount and shared by
 * list / create / join so namespaces are always scoped to (and created under)
 * the right app.
 *
 * Two sources, by session:
 *
 *  * An ACCOUNT (delegated) session: `useMero().applicationId`, which the
 *    provider resolved from the registry for THIS app's package. The node
 *    listing is never asked for — it is a node-wide route the relay refuses to
 *    an account, and the account has no install of its own to find.
 *
 *  * A NODE login: the installed application whose package is ours, asked of
 *    the node through the session's admin client. The desktop deep-links
 *    straight to the projects page (bypassing Teams), so every page resolves
 *    for itself rather than trusting a possibly-empty persisted id — otherwise
 *    createProject would POST an empty applicationId and the node rejects it
 *    ("invalid length 0"). The persisted id is the fallback when the node
 *    cannot answer.
 */
export function useApplicationId(): () => Promise<string> {
  const { admin, applicationId, isDelegated } = useMero();
  const appIdRef = useRef<string>("");
  return useCallback(async (): Promise<string> => {
    if (appIdRef.current) return appIdRef.current;
    let id = "";
    if (!isDelegated && admin) {
      try { id = await resolveApplicationId(admin); } catch { /* fall back below */ }
    }
    if (!id) id = applicationId ?? "";
    if (id) { appIdRef.current = id; setApplicationId(id); }
    return id;
  }, [admin, applicationId, isDelegated]);
}
