import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useToast } from "../contexts/ToastContext";
import { consentOutcomeCopy, returnFromConsent } from "../lib/orgConsent";
import { clearActiveAudience, getActiveNamespaceId } from "../lib/active";
import { useMaybeSignedIn } from "../lib/sessionContext";

/**
 * Back from the node's consent page (a company deleted, someone removed, a
 * company left): says what the node decided, and out of a company that is gone
 * for this account, back to the companies list. Creating a company, inviting and
 * joining are the shared dialogs', which resume their own.
 */
export default function ConsentReturn() {
  const client = useMaybeSignedIn()?.client ?? null;
  const { showToast } = useToast();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (!client || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const back = await returnFromConsent(client);
        if (!back) return;
        showToast(
          consentOutcomeCopy(back),
          back.approved ? "success" : "error",
        );
        if (!back.approved || back.kind === "removeMember") return;
        if (back.org && getActiveNamespaceId() === back.org) clearActiveAudience();
        navigate("/companies", { replace: true });
      } catch {
        showToast(
          "This approval did not come from a request made here. Nothing was changed.",
          "error",
        );
      }
    })();
  }, [client, showToast, navigate]);

  return null;
}
