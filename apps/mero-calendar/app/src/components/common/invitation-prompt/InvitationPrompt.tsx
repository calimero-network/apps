import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useSessionApi } from "../../../api/sessionContext";
import { dropInvite, joinedOrg, pendingInvite } from "../../../api/teams";
import { messageOf } from "../../../api/calendar";
import { useToast } from "../../../contexts/ToastContext";

/**
 * Redeems an invitation link once there is a session.
 *
 * A link is `?invite=<token>` (an org invite; `api/teams`). `index.tsx` moves
 * the token into storage before anything renders, so it survives the passkey
 * sign-up a new person goes through first; here it is redeemed and dropped,
 * and the team it opened is shown. v1's signed namespace invitation, the
 * desktop deep link and the confirm dialog are gone: the token is single-use
 * and only ever reaches the cluster this frontend talks to.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { api } = useSessionApi();
  const [busy, setBusy] = useState(false);
  const tried = useRef<string | null>(null);
  const signedIn = api.session.status === "signed-in" ? api.session : null;

  useEffect(() => {
    if (!signedIn) return;
    const token = pendingInvite();
    if (!token || tried.current === token) return;
    tried.current = token;
    setBusy(true);
    (async () => {
      try {
        const redeemed = await signedIn.client.redeemInvite(token);
        api.store?.sync(signedIn.client);
        dropInvite();
        const org = joinedOrg(redeemed);
        showToast("You joined the team.", "success");
        navigate(org ? `/teams/${org}` : "/teams");
      } catch (err) {
        dropInvite();
        showToast(`Could not join the team: ${messageOf(err)}`);
      } finally {
        setBusy(false);
      }
    })();
  }, [signedIn, api.store, navigate, showToast]);

  if (!busy) return null;
  return (
    <div className="mc-overlay" data-testid="invitation-redeeming">
      <p className="mc-card">Joining the team…</p>
    </div>
  );
}
