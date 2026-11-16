import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { hasConsentReturn, returnFromConsent } from "../api/consent";
import { useToast } from "../contexts/ToastContext";

interface Props {
  /** Read the team list again once a change was approved. */
  onChanged: () => void;
}

/**
 * Finishes what the app sent the person to the node's consent page for
 * (`api/consent.ts`), once they are back and signed in: a role or a removal
 * is said; a team left or deleted is closed, back to the team list. What was
 * decided is read from the node, never from the return URL.
 */
export default function ConsentReturn({ onChanged }: Props) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !hasConsentReturn()) return;
    started.current = true;
    void (async () => {
      let back;
      try {
        back = await returnFromConsent();
      } catch {
        showToast("Nothing was changed: this approval did not come from a request made here. Try again.");
        return;
      }
      if (!back) return;
      if (!back.approved) {
        showToast("Not approved. Nothing was changed.", "info");
        return;
      }
      onChanged();
      switch (back.intent?.kind) {
        case "setMemberRole":
          showToast(
            back.intent.role === "admin"
              ? "Member promoted to admin: they can now edit every board."
              : "Admin demoted to member.",
            "success",
          );
          return;
        case "removeMember":
          showToast("Member removed from the team.", "success");
          return;
        case "leaveOrg":
          showToast("You left the team.", "success");
          navigate("/teams", { replace: true });
          return;
        case "deleteOrg":
          showToast("Team deleted.", "success");
          navigate("/teams", { replace: true });
          return;
        default:
          showToast("Approved.", "success");
      }
    })();
  }, [showToast, navigate, onChanged]);

  return null;
}
