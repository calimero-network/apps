import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { messageOf } from "../api/pixart";
import { useSessionApi } from "../api/sessionContext";
import {
  INVITE_SPENT,
  dropInvite,
  inviteRefused,
  joinedOrg,
  listTeams,
  mintedOrg,
  pendingInvite,
} from "../api/teams";
import { useToast } from "../contexts/ToastContext";

type Outcome = { kind: "spent" } | { kind: "member"; org: string };

/**
 * Redeems an invitation link once there is a session.
 *
 * A link is `?invite=<token>` (an org invite; `api/teams`). `main.tsx` moves
 * the token into storage before anything renders, so it survives the passkey
 * sign-up a new person goes through first (on the invitation page, `App`);
 * here it is redeemed and dropped, and the team it opened is shown, unless the
 * link deep-linked into that team already. v1's signed namespace invitation,
 * the desktop deep link, the confirm dialog and the join sync are gone: the
 * token is single-use, only ever reaches the cluster this frontend talks to,
 * and a team's projects are there as soon as it is joined.
 *
 * Someone already in the invite's team is told so instead of redeeming it:
 * that would spend the single use on a person who needs none of it. The team
 * is known only for an invite this browser minted (`mintedOrg`); for any other
 * the invite is redeemed as before.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { api } = useSessionApi();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const tried = useRef<string | null>(null);
  const signedIn = api.session.status === "signed-in" ? api.session : null;
  const here = useRef(location.pathname);
  here.current = location.pathname;

  useEffect(() => {
    if (!signedIn) return;
    const token = pendingInvite();
    if (!token || tried.current === token) return;
    tried.current = token;
    setBusy(true);
    const open = (org: string | null) => {
      if (org && here.current.startsWith(`/teams/${org}/`)) return;
      navigate(org ? `/teams/${org}/projects` : "/teams");
    };
    (async () => {
      try {
        const minted = mintedOrg(token);
        if (minted) {
          const teams = await listTeams(signedIn.client).catch(() => null);
          if (teams?.some((t) => t.groupId === minted)) {
            dropInvite();
            setOutcome({ kind: "member", org: minted });
            return;
          }
        }
        const redeemed = await signedIn.client.redeemInvite(token);
        api.store?.sync(signedIn.client);
        dropInvite();
        showToast("You joined the team.", "success");
        open(joinedOrg(redeemed));
      } catch (err) {
        if (inviteRefused(err)) {
          dropInvite();
          setOutcome({ kind: "spent" });
        } else {
          // Not the invite's fault (the cluster is unreachable): keep it for the next load.
          showToast(`Could not join the team: ${messageOf(err)}`);
        }
      } finally {
        setBusy(false);
      }
    })();
  }, [signedIn, api.store, navigate, showToast]);

  if (outcome) {
    const member = outcome.kind === "member";
    const close = () => {
      setOutcome(null);
      if (member) navigate(`/teams/${outcome.org}/projects`);
    };
    return (
      <div className="mp-overlay" data-testid={member ? "invitation-already-member" : "invitation-spent"}>
        <div className="mp-modal" role="dialog" aria-modal="true" aria-labelledby="invitation-outcome-title">
          <h2 id="invitation-outcome-title">
            {member ? "You're already in this team" : "This invite can't be used"}
          </h2>
          <p className="sub" data-testid="invitation-error">
            {member
              ? "This invite is for a team you are a member of, so it was not used. It is still there for the person you meant to send it to."
              : INVITE_SPENT}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="mp-btn mp-btn--primary" onClick={close}>
              {member ? "Open the team" : "Close"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!busy) return null;
  return (
    <div className="mp-overlay" data-testid="invitation-redeeming">
      <p className="mp-modal">Joining the team…</p>
    </div>
  );
}
