import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalimeroError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import { useMaybeSignedIn, useSessionApi } from "../sessionContext";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { dropInvite, joinedOrg, pendingInvite, type PendingInvite } from "../lib/spaces";
import { setActiveForum } from "../lib/session";
import SignInModal from "./SignInModal";
import styles from "./InviteModal.module.css";

/**
 * "Join this space?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render, see `captureInvite`).
 *
 * Mounted at the APP level because a link can land on any route. It asks
 * rather than joins: joining puts you in someone's organization, and a
 * forwarded link or a refreshing background tab should not do that silently.
 *
 * Signed out, it offers the sign-in first; the token survives the sign-up.
 * Signed in, Join redeems the org invite and lands in the forum the link names
 * (a forum invitation) or on the space's forum list. There is no "Syncing…"
 * stage any more: nothing has to replicate before a new member can read.
 */
export default function InvitationPrompt() {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const ready = api.session.status === "signed-out" || api.session.status === "signed-in";
  useDialogOpen(dialogRef, !!invite && ready && !signingIn);

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
      if (invite.forum) {
        setActiveForum(invite.forum, org);
        navigate("/f");
      } else {
        navigate(org ? `/spaces/${org}` : "/spaces");
      }
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

  if (!invite) return null;

  return (
    <>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => !busy && setInvite(pendingInvite())}
        data-testid="invitation-dialog"
      >
        <div className={styles.body}>
          <header className={styles.head}>
            <h2 className={styles.title}>You&apos;re invited to Mero Forum</h2>
          </header>
          <p className={styles.hint}>
            {invite.forum
              ? "Joining gives you access to the space and takes you straight into the forum you were invited to."
              : "Joining gives you access to the space and every forum in it."}
          </p>
          {error && (
            <p className={styles.hint} role="alert" data-testid="invitation-error">
              {error}
            </p>
          )}
          {signedIn ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => void join()}
              disabled={busy}
              data-testid="invitation-join"
            >
              {busy ? "Joining…" : "Join"}
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setSigningIn(true)}
              data-testid="invitation-signin"
            >
              Sign in to join
            </button>
          )}
          <button type="button" className="ui-btn" onClick={dismiss} disabled={busy} data-testid="invitation-dismiss">
            Not now
          </button>
        </div>
      </dialog>
      <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
    </>
  );
}
