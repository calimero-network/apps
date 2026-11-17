import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { consentReturn, withoutConsentReturn } from "@calimero-network/mero-js";
import { targetKey } from "@calimero-apps/connect";

import { awaitingOrgReturn, returnFromOrgConsent, returnMessage } from "../api/orgConsent";
import { useSessionApi } from "../api/sessionContext";
import { useToast } from "../contexts/ToastContext";
import { forgetTeam } from "../utils/lastVisit";

/**
 * Where the consent page sent the person back to, read before the router
 * moves on from the root (a signed-in visit there opens the teams).
 */
const LANDED = typeof window === "undefined" ? "" : window.location.href;

/**
 * Finishes a team change the node's consent page approved (`api/orgConsent`)
 * once the person is back and signed in: says how it went, and a team left
 * or deleted is forgotten, back to the teams list.
 */
export default function ConsentReturn() {
  const { api } = useSessionApi();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const started = useRef(false);
  const signedIn = api.session.status === "signed-in" ? api.session : null;

  useEffect(() => {
    if (!signedIn || started.current || !consentReturn(LANDED) || !awaitingOrgReturn()) return;
    started.current = true;
    if (consentReturn(window.location.href)) {
      window.history.replaceState(window.history.state, "", withoutConsentReturn(window.location.href));
    }
    void returnFromOrgConsent(signedIn.client, LANDED).then((back) => {
      if (!back) return;
      const [message, kind] = returnMessage(back);
      showToast(message, kind);
      if ((back.kind === "left" || back.kind === "deleted") && back.org) {
        forgetTeam(targetKey(signedIn.target), back.org);
        navigate("/teams", { replace: true });
      }
    });
  }, [signedIn, showToast, navigate]);

  return null;
}
