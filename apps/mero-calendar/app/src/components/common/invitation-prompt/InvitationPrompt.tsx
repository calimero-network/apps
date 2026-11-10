import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PendingInvite } from "@calimero-apps/connect";
import { JoinInvitation, usePendingInvite } from "@calimero-apps/passkey";

import { useSessionApi } from "../../../api/sessionContext";
import { dropInvite, inviteRoute, invites, takeJoinedAtSignUp } from "../../../api/teams";
import { useToast } from "../../../contexts/ToastContext";
import styles from "../modals/username-modal/username-modal.module.scss";

const CLASS_NAMES = {
  root: styles.modal,
  title: styles.title,
  text: styles.sub,
  error: styles.sub,
  actions: styles.actions,
  primary: "mc-btn mc-btn--primary",
  secondary: "mc-btn mc-btn--ghost",
};

/**
 * "Join the team?" for an invitation link, once there is a session.
 *
 * A link is `?invite=<token>[&org=<team>][&to=<route>]` (an org invite;
 * `api/teams`). `index.tsx` moves it into the invite store before anything
 * renders, so it survives the passkey sign-up a new person goes through first
 * (on the invitation page, `InvitationPage`). A sign-up there joins in that
 * step and opens the team; anyone who signed in instead is ASKED before the
 * invite is redeemed (the shared `JoinInvitation`), as every other org app
 * asks: joining makes you a member of someone's organization, and a forwarded
 * link or the next account on this browser should not join silently.
 *
 * Someone already in the team is not joined again: redeeming spends the
 * link's single use. `JoinInvitation` checks the team the link names first and
 * says so instead. It drops the token before it shows "already in" or "used
 * up", so the invitation asked about stays on screen here until it closes.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { api } = useSessionApi();
  const signedIn = api.session.status === "signed-in" ? api.session : null;
  const pending = usePendingInvite(invites);
  const [asked, setAsked] = useState<PendingInvite | null>(null);
  // The invitation this screen is done with (joined, "Not now", closed). An
  // effect that held `pending` may still run once with the copy from before
  // the drop, so closing is by token, not by clearing `asked`.
  const [closed, setClosed] = useState<string | null>(null);
  const client = signedIn?.client ?? null;

  useEffect(() => {
    if (!client) setAsked(null);
    else if (pending) setAsked(pending);
  }, [client, pending]);

  // Signed up from a page holding the invite: already joined; open what it named.
  useEffect(() => {
    if (!client) return;
    const to = takeJoinedAtSignUp();
    if (to) navigate(to, { replace: true });
  }, [client, navigate]);

  const held = client ? (pending ?? asked) : null;
  const asking = held && held.token !== closed ? held : null;
  if (!signedIn || !asking) return null;

  const open = (org: string | null) => navigate(inviteRoute(asking) ?? (org ? `/teams/${org}` : "/teams"));

  return (
    <div className="mc-overlay">
      <JoinInvitation
        key={asking.token}
        client={signedIn.client}
        token={asking.token}
        org={asking.org}
        appName="Mero Calendar"
        joining="the team"
        gives="you will see its calendars and can add events to them."
        drop={dropInvite}
        after={() => api.store?.sync(signedIn.client)}
        onJoined={({ org }) => {
          setClosed(asking.token);
          showToast("You joined the team.", "success");
          open(org);
        }}
        onClose={({ member }) => {
          setClosed(asking.token);
          if (member) open(member);
        }}
        classNames={CLASS_NAMES}
        titleAs="h2"
      />
    </div>
  );
}
