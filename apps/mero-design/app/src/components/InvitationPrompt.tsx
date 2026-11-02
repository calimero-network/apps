import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CalimeroError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";
import { redeemInvitation } from "../api/rpc";
import { useSessionApi } from "../sessionContext";
import { dropInvite, pendingInvite, type PendingInvite } from "../utils/inviteLink";
import SignInModal from "./SignInModal";
import styles from "./InviteModal.module.css";

/**
 * "Join this team?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render, see `captureInvite`).
 *
 * Mounted once, above the routes, because a link can land on any page. It
 * asks rather than joins: joining puts you in someone's organization, and a
 * forwarded link or a refreshing background tab should not do that silently.
 * Signed out, it offers the sign-in first; the token survives the sign-up.
 * Signed in, Join redeems the org invite and opens the team. There is no
 * "Syncing…" stage any more: nothing has to replicate before a new member can
 * read the team's boards.
 */
export default function InvitationPrompt() {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const signedIn = api.session.status === "signed-in";
  const ready = signedIn || api.session.status === "signed-out";

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
      const org = await redeemInvitation(invite.token);
      dropInvite();
      setInvite(null);
      navigate(org ? `/teams/${org}/projects` : "/teams");
    } catch (e) {
      // A refusal (used, expired, revoked) can never succeed: drop it. Anything
      // else (the cluster unreachable) is kept for another try.
      if (e instanceof CalimeroError && e.status < 500) dropInvite();
      setError(`The invitation could not be accepted: ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  }, [signedIn, invite, navigate]);

  if (!invite || !ready) return null;

  return (
    <>
      {!signingIn &&
        createPortal(
          <div className={styles.overlay}>
            <div
              className={styles.modal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="invitation-title"
              data-testid="invitation-dialog"
            >
              <div className={styles.header}>
                <h2 id="invitation-title" className={styles.title}>You&apos;re invited to Mero Design</h2>
              </div>
              <p className={styles.desc}>Joining gives you access to the team and every board in it.</p>
              {error && (
                <p className={styles.error} role="alert" data-testid="invitation-error">
                  {error}
                </p>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={dismiss}
                  disabled={busy}
                  data-testid="invitation-dismiss"
                >
                  Not now
                </button>
                {signedIn ? (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => void join()}
                    disabled={busy}
                    data-testid="invitation-join"
                  >
                    {busy ? "Joining…" : "Join"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => setSigningIn(true)}
                    data-testid="invitation-signin"
                  >
                    Sign in to join
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
    </>
  );
}
