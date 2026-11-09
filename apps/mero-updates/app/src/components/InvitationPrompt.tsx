import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { describeError } from "@calimero-apps/connect";

import { useDialogOpen } from "../hooks/useDialogOpen";
import { setActiveAudience } from "../lib/active";
import {
  INVITE_REFUSED,
  alreadyMember,
  dropInvite,
  inviteRefused,
  joinedOrg,
  pendingInvite,
  type PendingInvite,
} from "../lib/companies";
import { useMaybeSignedIn, useSessionApi } from "../lib/sessionContext";
import styles from "./InviteModal.module.css";
import { UserPlusIcon, XIcon } from "./icons";

/**
 * "Join this company?" for an invitation that arrived as a link
 * (`?invite=<token>`, captured in `main.tsx`), once there is a session.
 *
 * Mounted at the app level, above the router, because a link can land on any
 * route. It asks rather than joins: joining is a state change, and a forwarded
 * link or a background tab that refreshes must not join silently. Joining
 * redeems the org invite; an audience link (`&audience=<id>`) then opens that
 * audience, a company link the company's audience list.
 *
 * A sign-up from the invitation page already joined with the invite
 * (`api.joinedInvite`): the token is dropped and what it names opened, with
 * nothing asked and nothing redeemed again.
 *
 * Someone already in the company (the inviter opening their own link) is told
 * so and the token dropped: redeeming it would spend its single use, and the
 * person it was meant for could no longer join. A refused invite (unknown,
 * used, expired, revoked) is said plainly.
 */
export default function InvitationPrompt() {
  const signedIn = useMaybeSignedIn();
  const { api } = useSessionApi();
  const joinedInvite = api.joinedInvite ?? null;
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  // `null` until the membership check answers; `false` too when it cannot.
  const [member, setMember] = useState<boolean | null>(null);
  // An invite the sign-up joined with: opened, never asked about.
  const [joinedAtSignUp, setJoinedAtSignUp] = useState<PendingInvite | null>(null);
  const client = signedIn?.client ?? null;

  useEffect(() => {
    const next = client ? reread(invite) : null;
    if (next && next.token === joinedInvite) {
      dropInvite();
      setInvite(null);
      setJoinedAtSignUp(next);
      return;
    }
    setInvite(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per session; `joinedInvite` is set before it signs in
  }, [client]);

  // Opened one render later: the landing page's own redirect into the app
  // runs in the sign-in's render, and would land after this navigation.
  useEffect(() => {
    if (!joinedAtSignUp) return;
    setJoinedAtSignUp(null);
    open(navigate, joinedAtSignUp, joinedAtSignUp.org);
  }, [joinedAtSignUp, navigate]);

  useEffect(() => {
    if (!client || !invite) return undefined;
    let live = true;
    setMember(null);
    void alreadyMember(client, invite).then((known) => {
      if (!live) return;
      if (known) dropInvite();
      setMember(known ?? false);
    });
    return () => {
      live = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per token, not per re-read
  }, [client, invite?.token]);
  useDialogOpen(dialogRef, !!invite && member !== null);

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
      const redeemed = await signedIn.client.redeemInvite(invite.token);
      signedIn.after();
      const org = joinedOrg(redeemed);
      dropInvite();
      setInvite(null);
      open(navigate, invite, org);
    } catch (e) {
      // A refusal can never succeed: drop it. Anything else (the cluster
      // unreachable) is kept for another try.
      if (inviteRefused(e)) {
        dropInvite();
        setRefused(true);
        setError(INVITE_REFUSED);
      } else {
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  }, [signedIn, invite, navigate]);

  const openCompany = () => {
    const org = invite?.org;
    dismiss();
    navigate(org ? `/companies/${org}` : "/companies");
  };

  if (!invite) return null;
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={() => !busy && dismiss()}
      aria-labelledby="invitation-title"
      data-testid="invitation-dialog"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <span className={styles.tile} aria-hidden>
            <UserPlusIcon size={18} />
          </span>
          <div className={styles.headText}>
            <h2 className={styles.title} id="invitation-title">
              {member ? "You're already in this company" : "Join this company?"}
            </h2>
            <p className={styles.scope} data-testid={member ? "invitation-member" : undefined}>
              {member
                ? "This invitation is for a company you are already a member of, so there is nothing to join. The link was left unused for whoever it was meant for."
                : invite.audience
                  ? "Joining takes you straight into the audience you were invited to."
                  : "Joining gives you access to the company and every audience in it."}
            </p>
          </div>
          <button type="button" className={styles.close} onClick={dismiss} aria-label="Close" disabled={busy}>
            <XIcon size={16} />
          </button>
        </header>
        {member ? (
          <button type="button" className={styles.primary} onClick={openCompany} data-testid="invitation-open">
            Open it
          </button>
        ) : (
          !refused && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => void join()}
              disabled={busy}
              data-testid="invitation-join"
            >
              {busy ? "Joining…" : "Join"}
            </button>
          )
        )}
        {!member && (
          <button type="button" className="secondary" onClick={dismiss} disabled={busy}>
            {refused ? "Close" : "Not now"}
          </button>
        )}
        {error && (
          <p className="error" role="alert" data-testid="invitation-error">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}

/** What a joined invitation opens: the audience its link names, else the company. */
function open(navigate: NavigateFunction, invite: PendingInvite, org: string | null): void {
  if (org && invite.audience) {
    setActiveAudience(invite.audience, org);
    navigate("/a");
  } else {
    navigate(org ? `/companies/${org}` : "/companies");
  }
}

/**
 * The invitation to ask about once there is a session: the one already held,
 * or the stored one. Never a fresh copy of the one held: that would re-run the
 * membership check and close and reopen the dialog (closing it is "Not now"),
 * and after the check has dropped an already-member's token it would lose the
 * "You're already in" answer before anyone read it.
 */
function reread(prev: PendingInvite | null): PendingInvite | null {
  return prev ?? pendingInvite();
}
