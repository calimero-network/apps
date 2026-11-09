import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useMaybeSignedIn, useSessionApi } from '../sessionContext';
import { setActiveWorkspace } from '../lib/activeWorkspace';
import { enterAgreement } from '../lib/agreements';
import {
  INVITE_REFUSED,
  alreadyMember,
  dropInvite,
  inviteRefused,
  joinedOrg,
  pendingInvite,
  type PendingInvite,
} from '../lib/invites';
import { errorMessage, setContextId } from '../lib/node';
import styles from '../pages/app/AgreementsPage.module.css';

/**
 * "Join this workspace?" for an invitation that arrived as a link
 * (`?invite=<token>[&agreement=<app id>]`, taken into storage before the first
 * render, see `captureInvite`).
 *
 * Mounted at the APP level because a link can land on any route. It asks
 * rather than joins: joining puts you in someone's workspace, and a forwarded
 * link should not do that silently. Signed out, `InvitationPage` stands in for
 * the app and offers the passkey sign-in; the token survives a sign-in, and
 * this asks the moment a session exists. A sign-up from that page already
 * joined with it (`api.joinedInvite`): this goes straight on to what the link
 * names, with nothing redeemed again. Someone already in the workspace (the
 * inviter opening their own link) is told so and the token dropped: redeeming
 * it would spend its single use, and the person it was meant for could no
 * longer join. A refused invite (unknown, used, expired, revoked) is said
 * plainly.
 *
 * Joining redeems the org invite, then, for a link that names an agreement,
 * puts you on its roster as a signer (`registerSelfAsParticipant`) and records
 * it in your private library before opening it. There is no "waiting for the
 * agreement to replicate" stage any more: nothing has to sync before a new
 * member can read.
 */
export default function InvitationHandlerPopup() {
  const signedIn = useMaybeSignedIn();
  const { api } = useSessionApi();
  const joinedInvite = api.joinedInvite ?? null;
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() =>
    pendingInvite(),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  // `null` until the membership check answers; `false` too when it cannot.
  const [member, setMember] = useState<boolean | null>(null);
  // Joined (by the sign-up, or a redeem whose next step failed), and into
  // which org: only what the link names is left, never a second redeem.
  const [joined, setJoined] = useState<{ org: string | null } | null>(null);
  const client = signedIn?.client ?? null;
  const joinedHere = invite !== null && invite.token === joinedInvite;

  useEffect(() => {
    if (!client || !invite || joinedHere) return undefined;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per token
  }, [client, invite?.token]);

  /** Already a member: nothing to redeem, just open what the link names. */
  const openIt = useCallback(() => {
    if (!invite) return;
    dropInvite();
    setInvite(null);
    if (invite.org) setActiveWorkspace(invite.org);
    navigate(
      invite.agreement
        ? `/agreements/${invite.agreement}`
        : invite.org
          ? `/workspaces/${invite.org}`
          : '/workspaces',
      { replace: true },
    );
  }, [invite, navigate]);

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
  }, []);

  /**
   * Redeems the invite (unless the sign-up already joined with it), then
   * opens what the link names.
   */
  const join = useCallback(async () => {
    if (!signedIn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      let org: string | null;
      if (joined) {
        org = joined.org;
      } else {
        setStatus('Joining the workspace…');
        org = joinedOrg(await signedIn.client.redeemInvite(invite.token));
        dropInvite();
        // Joined: a failure from here on is retried without redeeming again.
        setJoined({ org });
      }
      if (org) setActiveWorkspace(org);
      if (invite.agreement) {
        setStatus('Recording you as a participant so you can sign.');
        const apps = await signedIn.client.listApps().catch(() => []);
        const name =
          apps.find((a) => a.appId === invite.agreement)?.name ?? 'Agreement';
        await enterAgreement(
          signedIn.client,
          {
            source: signedIn.source,
            appId: invite.agreement,
            accountId: signedIn.accountId,
            name,
          },
          signedIn.after,
        );
        setContextId(invite.agreement);
        setInvite(null);
        navigate(`/agreements/${invite.agreement}`, { replace: true });
      } else {
        setInvite(null);
        navigate(org ? `/workspaces/${org}` : '/workspaces', { replace: true });
      }
    } catch (e) {
      // A refusal (unknown, used, expired, revoked) can never succeed: drop
      // it. Anything else (the cluster unreachable) is kept for another try.
      // Once joined, there is no invite left to refuse.
      if (!joined && inviteRefused(e)) {
        dropInvite();
        setRefused(true);
        setError(INVITE_REFUSED);
      } else {
        setError(`The invitation could not be accepted: ${errorMessage(e)}`);
      }
    } finally {
      setBusy(false);
      setStatus(null);
      signedIn.after();
    }
  }, [signedIn, invite, navigate, joined]);

  // Signed up on the invitation page with this invite: joined already, so go
  // on to what it names. Only a failure there shows the dialog.
  useEffect(() => {
    if (!client || !joinedHere || joined) return;
    dropInvite();
    setMember(false);
    setJoined({ org: invite?.org ?? null });
  }, [client, joinedHere, joined, invite?.org]);
  const started = useRef(false);
  useEffect(() => {
    if (!joined || !joinedHere || started.current) return;
    started.current = true;
    void join();
  }, [joined, joinedHere, join]);

  if (!signedIn || !invite || member === null) return null;
  // Opening what a sign-up joined: nothing to ask unless it failed.
  if (joinedHere && !error) return null;

  if (member) {
    return (
      <div className={styles.modalBackdrop}>
        <div
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="invitation-title"
          data-testid="invitation-dialog"
        >
          <h2 className={styles.modalTitle} id="invitation-title">
            You&apos;re already in this workspace
          </h2>
          <p className={styles.modalDesc} data-testid="invitation-member">
            This invitation is for a workspace you are already a member of, so
            there is nothing to join. The link was left unused for whoever it
            was meant for.
          </p>
          <div className={styles.modalRow}>
            <button
              type="button"
              className={styles.btn}
              onClick={openIt}
              data-testid="invitation-open"
            >
              Open it
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.modalBackdrop}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invitation-title"
        data-testid="invitation-dialog"
      >
        <h2 className={styles.modalTitle} id="invitation-title">
          {joined ? 'You joined the workspace' : 'Join the workspace?'}
        </h2>
        <p className={styles.modalDesc}>
          {invite.agreement
            ? 'Joining gives you access to the workspace and takes you straight into the agreement you were invited to sign.'
            : 'Joining gives you access to the workspace and every agreement in it.'}
        </p>
        {status && <p className={styles.hint}>{status}</p>}
        {error && (
          <p className={styles.error} role="alert" data-testid="invitation-error">
            {error}
          </p>
        )}
        <div className={styles.modalRow}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={dismiss}
            disabled={busy}
            data-testid="invitation-dismiss"
          >
            {refused ? 'Close' : 'Not now'}
          </button>
          {!refused && (
            <button
              type="button"
              className={styles.btn}
              onClick={() => void join()}
              disabled={busy}
              data-testid="invitation-join"
            >
              {busy ? <span className={styles.spinner} /> : null}
              {busy ? (joined ? 'Opening…' : 'Joining…') : joined ? 'Try again' : 'Join'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
