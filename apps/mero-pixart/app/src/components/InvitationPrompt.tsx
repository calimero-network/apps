import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalimeroError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import { dropInvite, joinedOrg, pendingInvite, type PendingInvite } from "../api/teams";
import { useMaybeSignedIn, useSessionApi } from "../sessionContext";
import SignInModal from "./SignInModal";
import styles from "./InviteModal.module.css";

/**
 * "Join this team?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render, see `captureInvite`).
 *
 * Mounted above the routes because a link can land on any page. It asks
 * rather than joins: joining puts you in someone's organization, and a
 * forwarded link should not do that silently. Signed out, it offers the
 * sign-in first; the token survives the sign-up. Signed in, Join redeems the
 * org invite and lands in the project the link names, or on the team's project
 * list. There is no "Syncing…" stage any more: nothing has to replicate before
 * a new member can open a project.
 */
export default function InvitationPrompt() {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const ready = api.session.status === "signed-out" || api.session.status === "signed-in";

  useEffect(() => {
    if (signedIn) setSigningIn(false);
  }, [signedIn]);

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
  }, []);

  const join = useCallback(async () => {
    if (!signedIn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await signedIn.client.redeemInvite(invite.token));
      dropInvite();
      setInvite(null);
      if (org && invite.project) navigate(`/teams/${org}/projects/${invite.project}`);
      else navigate(org ? `/teams/${org}/projects` : "/teams");
    } catch (e) {
      // A refusal (used, expired, revoked) can never succeed: drop it. Anything
      // else (the cluster unreachable) is kept for another try.
      if (e instanceof CalimeroError && e.status < 500) dropInvite();
      setError(`The invitation could not be accepted: ${describeError(e)}`);
    } finally {
      setBusy(false);
      signedIn.after();
    }
  }, [signedIn, invite, navigate]);

  if (!invite || !ready) return null;

  return (
    <>
      {!signingIn && (
        <div className="mp-overlay" data-testid="invitation-dialog">
          <div className={`mp-modal ${styles.modal}`}>
            <div className={styles.header}>
              <h2 className={styles.title}>You&apos;re invited to a Mero PixArt team</h2>
            </div>
            <p className={styles.desc}>
              {invite.project
                ? "Joining gives you access to the team and opens the project you were invited to."
                : "Joining gives you access to the team and every project in it."}
            </p>
            {error && <p className={styles.error} role="alert" data-testid="invitation-error">{error}</p>}
            {signedIn ? (
              <button className="mp-btn mp-btn--primary" onClick={() => void join()} disabled={busy} data-testid="invitation-join">
                {busy ? "Joining…" : "Join"}
              </button>
            ) : (
              <button className="mp-btn mp-btn--primary" onClick={() => setSigningIn(true)} data-testid="invitation-signin">
                Sign in to join
              </button>
            )}
            <button className="mp-btn mp-btn--ghost" onClick={dismiss} disabled={busy} data-testid="invitation-dismiss">
              Not now
            </button>
          </div>
        </div>
      )}
      <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
    </>
  );
}
