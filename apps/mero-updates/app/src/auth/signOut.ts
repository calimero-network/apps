import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { clearActiveAudience } from "../lib/active";
import { useSessionApi } from "../lib/sessionContext";

/**
 * Sign out: forget the open audience first (the next account on this browser
 * must not inherit it), then end the session and return to the front door.
 */
export function useSignOut(): () => void {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  return useCallback(() => {
    clearActiveAudience();
    void api.signOut().finally(() => navigate("/", { replace: true }));
  }, [api, navigate]);
}
