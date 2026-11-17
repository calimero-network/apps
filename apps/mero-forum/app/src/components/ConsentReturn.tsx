import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useToast } from "../contexts/ToastContext";
import { consentOutcomeCopy, returnFromConsent } from "../lib/orgConsent";
import { clearActiveForum, getActiveNamespaceId } from "../lib/session";
import { useMaybeSignedIn } from "../sessionContext";

/**
 * Back from the node's consent page (a space deleted, someone removed, a
 * space left): says what the node decided, and out of a space that is gone
 * for this account, back to the spaces list. Creating a space, inviting and
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
        if (back.org && getActiveNamespaceId() === back.org) clearActiveForum();
        navigate("/spaces", { replace: true });
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
