import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { describeError } from "@calimero-apps/connect";

import { useMaybeSignedIn } from "../sessionContext";
import { useDialogOpen } from "../hooks/useDialogOpen";
import {
  INVITE_SPENT,
  dropInvite,
  inviteRefused,
  joinedOrg,
  mintedOrg,
  pendingInvite,
  roleIn,
  type PendingInvite,
} from "../lib/spaces";
import { setActiveForum } from "../lib/session";
import styles from "./InviteModal.module.css";

/**
 * "Join this space?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render, see `captureInvite`).
 *
 * Mounted at the APP level because a link can land on any route. It asks
 * rather than joins: joining puts you in someone's organization, and a
 * forwarded link or a refreshing background tab should not do that silently.
 *
 * Signed out, the visitor is on the invitation page (`InvitationPage`, via
 * `App`'s `InvitationGate`) and this shows nothing; the token survives the
 * sign-up. Signed in, Join redeems the org invite and lands in the forum the
 * link names (a forum invitation) or on the space's forum list, unless the
 * link already deep-linked into a post. There is no "Syncing…" stage any
 * more: nothing has to replicate before a new member can read.
 *
 * Someone already in the invite's space is told so instead: redeeming would
 * spend the invite's single use on a person who needs none of it. The space
 * is known only for an invite this browser minted (`mintedOrg`); for any other
 * the prompt stays.
 */
export default function InvitationPrompt() {
  const signedIn = useMaybeSignedIn();
  const navigate = useNavigate();
  const location = useLocation();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The space of an invite this account is already a member of. */
  const [memberOf, setMemberOf] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useDialogOpen(dialogRef, !!signedIn && !!invite && !checking);

  // The invitation page may have been the way in: re-read once signed in.
  useEffect(() => {
    if (signedIn) setInvite(pendingInvite());
  }, [signedIn]);

  const client = signedIn?.client ?? null;
  const token = invite?.token ?? null;
  useEffect(() => {
    if (!client || !token) return;
    const org = mintedOrg(token);
    if (!org) return;
    let live = true;
    setChecking(true);
    roleIn(client, org)
      .then((role) => {
        if (!live || !role) return;
        dropInvite();
        setMemberOf(org);
      })
      .catch(() => {
        /* unknown: keep the prompt */
      })
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [client, token]);

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
    setMemberOf(null);
  }, []);

  const join = useCallback(async () => {
    if (!signedIn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await signedIn.client.redeemInvite(invite.token));
      dropInvite();
      setInvite(null);
      const deepLinked = /^\/(p\/|f$)/.test(location.pathname);
      if (invite.forum) {
        setActiveForum(invite.forum, org);
        if (!deepLinked) navigate("/f");
      } else {
        navigate(org ? `/spaces/${org}` : "/spaces");
      }
    } catch (e) {
      // A refusal (used, expired, revoked) can never succeed: drop it. Anything
      // else (the cluster unreachable) is kept for another try.
      if (inviteRefused(e)) {
        dropInvite();
        setError(INVITE_SPENT);
      } else {
        setError(`The invitation could not be accepted: ${describeError(e)}`);
      }
    } finally {
      setBusy(false);
      signedIn.after();
    }
  }, [signedIn, invite, navigate, location.pathname]);

  if (!signedIn || !invite) return null;

  if (memberOf) {
    return (
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={dismiss}
        data-testid="invitation-already-member"
      >
        <div className={styles.body}>
          <header className={styles.head}>
            <h2 className={styles.title}>You&apos;re already in this space</h2>
          </header>
          <p className={styles.hint}>
            This invite is for a space you are a member of, so it was not used. It is still there for the person you
            meant to send it to.
          </p>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              dismiss();
              navigate(`/spaces/${memberOf}`);
            }}
          >
            Open the space
          </button>
        </div>
      </dialog>
    );
  }

  return (
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
        {!error && (
          <button
            type="button"
            className={styles.primary}
            onClick={() => void join()}
            disabled={busy}
            data-testid="invitation-join"
          >
            {busy ? "Joining…" : "Join"}
          </button>
        )}
        <button type="button" className="ui-btn" onClick={dismiss} disabled={busy} data-testid="invitation-dismiss">
          {error ? "Close" : "Not now"}
        </button>
      </div>
    </dialog>
  );
}
