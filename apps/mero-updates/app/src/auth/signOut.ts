import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-apps/cloud";

import { clearActiveAudience } from "../lib/session";

/**
 * Log out: forget which audience this browser had open, then let mero-react
 * drop the session (its token store, the `mero:*` keys and any delegated
 * account), the same way Mero CRM and Mero Calendar do.
 *
 * The active audience is OUR state, not the SDK's: `logout()` clears tokens and
 * knows nothing about it. Left behind, the next person to sign in on this
 * browser boots straight into the previous session's audience, because `/`
 * redirects to /a whenever a context id is stored and RequireAudience only
 * checks that one exists, not that it is theirs. The light/dark choice stays:
 * it belongs to the browser, not the account.
 */
export function signOut(logout: () => void): void {
  clearActiveAudience();
  logout();
}

/** `signOut`, then back to the front door. The route guards would bounce there
 *  anyway once the session is gone; going explicitly keeps the URL clean. */
export function useSignOut(): () => void {
  const { logout } = useMero();
  const navigate = useNavigate();
  return useCallback(() => {
    signOut(logout);
    navigate("/", { replace: true });
  }, [logout, navigate]);
}
