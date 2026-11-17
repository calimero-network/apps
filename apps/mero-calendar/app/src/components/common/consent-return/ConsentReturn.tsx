import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { targetKey } from "@calimero-apps/connect";

import { consentReturnPending, returnFromConsent } from "../../../api/consent";
import { useSessionApi } from "../../../api/sessionContext";
import { useToast } from "../../../contexts/ToastContext";
import { forgetTeam } from "../../../utils/lastVisit";

/**
 * Finishes what the app sent the person to the node's consent page for, when
 * the page sends them back (see `api/consent.ts`): a role or a removal is
 * said; a team left or deleted is forgotten, back to the teams list. A team's
 * creation and invites are the shared dialogs'. The decision is the node's,
 * never the return URL's, and a return this tab did not start is refused.
 */
export default function ConsentReturn() {
  const { api } = useSessionApi();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const started = useRef(false);
  const session = api.session.status === "signed-in" ? api.session : null;

  useEffect(() => {
    // Only a return this app kept an intent for: the shared dialogs resume their own.
    if (!session || started.current || !consentReturnPending()) return;
    started.current = true;
    void (async () => {
      let returned;
      try {
        returned = await returnFromConsent(session.client);
      } catch {
        showToast("Nothing was changed: this approval did not come from a request made here. Try again.");
        return;
      }
      if (!returned) return;
      const { intent, result } = returned;
      if (result.status !== "approved") {
        showToast("Not approved. Nothing was changed.");
        return;
      }
      switch (intent?.kind) {
        case "setMemberRole":
          showToast(
            intent.role === "admin"
              ? `${intent.name} can now manage members and delete calendars.`
              : `${intent.name} is a member again.`,
            "success",
          );
          return;
        case "removeMember":
          showToast(`${intent.name} was removed from the team.`, "success");
          return;
        case "leaveOrg":
        case "deleteOrg":
          forgetTeam(targetKey(session.target), intent.org);
          showToast(intent.kind === "leaveOrg" ? "You left the team." : "Team deleted.", "success");
          navigate("/teams", { replace: true });
          return;
        default:
          return;
      }
    })();
  }, [session, showToast, navigate]);

  return null;
}
