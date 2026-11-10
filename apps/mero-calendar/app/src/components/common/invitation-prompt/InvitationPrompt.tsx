import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useSessionApi } from "../../../api/sessionContext";
import {
  dropInvite,
  inviteFailure,
  inviteRefused,
  joinedOrg,
  pendingInvite,
  pendingInviteOrg,
  pendingInviteRoute,
  readOrg,
  takeJoinedAtSignUp,
} from "../../../api/teams";
import { useToast } from "../../../contexts/ToastContext";
import styles from "../modals/username-modal/username-modal.module.scss";

type Outcome =
  | { kind: "joining" }
  | { kind: "member"; org: string; route: string | null }
  | { kind: "failed"; message: string };

/**
 * Redeems an invitation link once there is a session.
 *
 * A link is `?invite=<token>[&org=<team>]` (an org invite; `api/teams`).
 * `index.tsx` moves it into storage before anything renders, so it survives
 * the passkey sign-up a new person goes through first (on the invitation
 * page, `InvitationPage`); here it is redeemed and dropped, and the team it
 * opened is shown, or the route the link was opened on.
 *
 * ⚠️ Someone already in the team is not joined again. Redeeming spends the
 * link's single use, so the owner trying their own link used to leave the
 * person it was meant for with "unknown invite". When the link names its team
 * and the team lists this account, the token is dropped unspent and the
 * person is told so; when it cannot tell, it joins as before.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { api } = useSessionApi();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const tried = useRef<string | null>(null);
  const signedIn = api.session.status === "signed-in" ? api.session : null;

  // Signed up from a page holding the invite: already joined; open what it named.
  useEffect(() => {
    if (!signedIn) return;
    const to = takeJoinedAtSignUp();
    if (to) navigate(to, { replace: true });
  }, [signedIn, navigate]);

  useEffect(() => {
    if (!signedIn) return;
    const token = pendingInvite();
    if (!token || tried.current === token) return;
    tried.current = token;
    const named = pendingInviteOrg();
    const route = pendingInviteRoute();
    setOutcome({ kind: "joining" });
    (async () => {
      if (named) {
        const team = await readOrg(signedIn.client, named).catch(() => null);
        if (team?.roles.has(signedIn.accountId)) {
          dropInvite();
          setOutcome({ kind: "member", org: named, route });
          return;
        }
      }
      try {
        const redeemed = await signedIn.client.redeemInvite(token);
        api.store?.sync(signedIn.client);
        dropInvite();
        const org = joinedOrg(redeemed) ?? named;
        setOutcome(null);
        showToast("You joined the team.", "success");
        navigate(route ?? (org ? `/teams/${org}` : "/teams"));
      } catch (err) {
        // A refusal (unknown, used, expired, revoked) can never succeed: drop
        // it. Anything else (a lapsed session, a rate limit, the cluster
        // unreachable) is kept for a reload.
        if (inviteRefused(err)) dropInvite();
        setOutcome({ kind: "failed", message: inviteFailure(err) });
      }
    })();
  }, [signedIn, api.store, navigate, showToast]);

  if (!outcome) return null;
  if (outcome.kind === "joining") {
    return (
      <div className="mc-overlay" data-testid="invitation-redeeming">
        <p className="mc-card">Joining the team…</p>
      </div>
    );
  }

  const member = outcome.kind === "member";
  return (
    <div className="mc-overlay" data-testid="invitation-outcome">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="invitation-outcome-title">
        <h2 id="invitation-outcome-title" className={styles.title}>
          {member ? "You're already in this team" : "Couldn't join the team"}
        </h2>
        <p className={styles.sub} role={member ? undefined : "alert"} data-testid="invitation-message">
          {member
            ? "This account is already a member, so there is nothing to accept. The link is left unused for the person it was meant for."
            : outcome.message}
        </p>
        <div className={styles.actions}>
          <button
            className="mc-btn"
            data-testid="invitation-close"
            onClick={() => {
              setOutcome(null);
              if (member) navigate(outcome.route ?? `/teams/${outcome.org}`);
            }}
          >
            {member ? "Open the team" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
