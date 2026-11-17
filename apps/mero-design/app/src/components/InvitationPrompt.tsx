import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AcceptInviteDialog } from "@calimero-network/mero-react";
import { useAskedInvite } from "@calimero-apps/passkey";
import { publishMyName } from "../api/names";
import { readTeam } from "../api/rpc";
import { suggestedName } from "../utils/boardName";
import UsernameModal from "./UsernameModal";
import { useAuth, useSessionApi } from "../sessionContext";
import { inviteDestination, invites, takeJoinedAtSignUp } from "../utils/inviteLink";

const ACCEPT_LABELS = {
  noun: "team",
  title: "Join this team",
  body: "You were invited to a team in Hyperfeed Design. Join it to see its boards.",
  join: "Join the team",
};

/**
 * "Join this team?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render, see `captureInvite`).
 *
 * Mounted once, above the routes, because a link can land on any page. It
 * asks rather than joins (the shared `AcceptInviteDialog`, through the node's
 * consent page): joining puts you in someone's organization, and a forwarded
 * link or a refreshing background tab should not do that silently.
 *
 * Signed out it renders nothing: the invitation is then the whole page
 * (`InvitationPage`, on the front door), whose sign-in brings the visitor
 * straight back here. Signed in, Join redeems the org invite and opens the
 * team, or the route the link was opened on. A team that has no name for you
 * asks for one first, once: every board in the team uses it.
 *
 * Someone already in the team is not offered Join. Redeeming spends the
 * link's single use, so when the link names its team (`&org=`) the dialog
 * checks it first and says so instead; continuing opens the team.
 */
export default function InvitationPrompt() {
  const { isAuthenticated: signedIn, accountId } = useAuth();
  const { binding } = useSessionApi();
  const navigate = useNavigate();
  // The invite stays on screen until closed, though the store drops it first.
  const { invite, close } = useAskedInvite(invites, signedIn);
  // Joined, and asking your name in the team before going on to `to`.
  const [naming, setNaming] = useState<{ org: string; to: string } | null>(null);

  // Signed up from a page holding the invite: already joined; open what it named.
  useEffect(() => {
    if (!signedIn) return;
    const to = takeJoinedAtSignUp();
    if (to) navigate(to, { replace: true });
  }, [signedIn, navigate]);

  const joined = useCallback(
    async (org: string | null) => {
      const to = inviteDestination(invite, org);
      close();
      // Your name in the team, asked once, here: never again on its boards.
      // Unknown (the read failed): the team's first board asks instead.
      const named = org && accountId ? await readTeam(org).then((t) => t.names.has(accountId), () => true) : true;
      if (org && !named) setNaming({ org, to });
      else navigate(to);
    },
    [invite, close, accountId, navigate],
  );

  const named = useCallback(
    async (name: string) => {
      if (!naming) return;
      // Best effort: refused, the team's first board asks again.
      if (accountId) await publishMyName(naming.org, accountId, name).catch(() => {});
      setNaming(null);
      navigate(naming.to);
    },
    [naming, accountId, navigate],
  );

  if (naming && signedIn) {
    return createPortal(
      <UsernameModal onSubmit={(n) => void named(n)} initialValue={suggestedName(accountId)} />,
      document.body,
    );
  }

  if (!invite || !signedIn || !binding) return null;

  return createPortal(
    <AcceptInviteDialog
      key={invite.token}
      open
      client={binding.client}
      passkey={binding.passkey()}
      token={invite.token}
      org={invite.org ?? undefined}
      appName="Hyperfeed Design"
      labels={ACCEPT_LABELS}
      onError={() => invites.drop()}
      onClose={() => {
        invites.drop();
        close();
      }}
      onJoined={({ org }) => {
        invites.drop();
        binding.after();
        void joined(org ?? invite.org ?? null);
      }}
    />,
    document.body,
  );
}
