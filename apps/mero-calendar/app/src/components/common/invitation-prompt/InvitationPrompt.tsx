import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { lastUsedName } from "@calimero-apps/names";
import { AcceptInviteDialog } from "@calimero-network/mero-react";
import { useAskedInvite } from "@calimero-apps/passkey";

import { useSessionApi } from "../../../api/sessionContext";
import { dropInvite, inviteRoute, invites, readOrg, setMyTeamName, takeJoinedAtSignUp } from "../../../api/teams";
import { useToast } from "../../../contexts/ToastContext";
import UsernameModal from "../modals/username-modal/UsernameModal";

const ACCEPT_LABELS = {
  noun: "team",
  title: "Join the team",
  body: "You were invited to a team in Mero Calendar. Joining it, you will see its calendars.",
  join: "Join the team",
};

/**
 * "Join the team?" for an invitation link, once there is a session.
 *
 * A link is `?invite=<token>[&org=<team>][&to=<route>]` (an org invite;
 * `api/teams`). `index.tsx` moves it into the invite store before anything
 * renders, so it survives the passkey sign-up a new person goes through first
 * (on the invitation page, `InvitationPage`). A sign-up there joins in that
 * step and opens the team; anyone who signed in instead is ASKED before the
 * invite is redeemed (the shared `AcceptInviteDialog`, through the node's consent
 * page): joining makes you a member of someone's organization, and a forwarded
 * link or the next account on this browser should not join silently.
 *
 * Someone already in the team is not joined again: redeeming spends the
 * link's single use. The dialog checks the team the link names and says so
 * instead; continuing opens the team.
 *
 * Joining is where your name in the team is asked, once: every calendar in
 * the team uses it. A team that already has one for you is opened at once.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { api, deps } = useSessionApi();
  const signedIn = api.session.status === "signed-in" ? api.session : null;
  /** Joined, and the team has no name for you yet: asked once, here. */
  const [naming, setNaming] = useState<{ org: string; to: string } | null>(null);
  const client = signedIn?.client ?? null;
  const { invite: asking, close } = useAskedInvite(invites, client !== null);

  // Signed up from a page holding the invite: already joined; open what it named.
  useEffect(() => {
    if (!client) return;
    const to = takeJoinedAtSignUp();
    if (to) navigate(to, { replace: true });
  }, [client, navigate]);

  if (naming && signedIn) {
    const { org, to } = naming;
    const done = () => {
      setNaming(null);
      navigate(to);
    };
    return (
      <UsernameModal
        defaultName={lastUsedName()}
        onSubmit={async (name) => {
          if (name.trim()) {
            // Best effort: a calendar in the team asks again if this did not land.
            await setMyTeamName(signedIn.client, org, signedIn.accountId, name).catch(() => {});
          }
          done();
        }}
        onSkip={done}
      />
    );
  }

  if (!signedIn || !asking) return null;

  const destination = (org: string | null) => inviteRoute(asking) ?? (org ? `/teams/${org}` : "/teams");
  const open = (org: string | null) => navigate(destination(org));

  return (
    <AcceptInviteDialog
      key={asking.token}
      open
      client={signedIn.client}
      passkey={deps.passkey()}
      token={asking.token}
      org={asking.org ?? undefined}
      appName="Mero Calendar"
      labels={ACCEPT_LABELS}
      onError={dropInvite}
      onClose={() => {
        dropInvite();
        close();
      }}
      onJoined={({ org, alreadyMember }) => {
        dropInvite();
        close();
        if (!alreadyMember) showToast("You joined the team.", "success");
        api.store?.sync(signedIn.client);
        if (!org) {
          open(org);
          return;
        }
        const to = destination(org);
        // A team that cannot be read now asks when a calendar in it opens.
        void readOrg(signedIn.client, org)
          .catch(() => null)
          .then((team) => {
            if (team && !team.names.get(signedIn.accountId)) setNaming({ org, to });
            else navigate(to);
          });
      }}
    />
  );
}
