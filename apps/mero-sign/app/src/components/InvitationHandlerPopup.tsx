import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalimeroError } from '@calimero-network/mero-js';

import { useMaybeSignedIn, useSessionApi } from '../sessionContext';
import { setActiveWorkspace } from '../lib/activeWorkspace';
import { enterAgreement } from '../lib/agreements';
import {
  dropInvite,
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
 * link should not do that silently. Signed out, it offers the passkey sign-in
 * first; the token survives the sign-up.
 *
 * Joining redeems the org invite, then, for a link that names an agreement,
 * puts you on its roster as a signer (`registerSelfAsParticipant`) and records
 * it in your private library before opening it. There is no "waiting for the
 * agreement to replicate" stage any more: nothing has to sync before a new
 * member can read.
 */
export default function InvitationHandlerPopup() {
  const { api, openSignIn, signInOpen } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() =>
    pendingInvite(),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setStatus('Joining the workspace…');
      const org = joinedOrg(await signedIn.client.redeemInvite(invite.token));
      dropInvite();
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
      // A refusal (used, expired, revoked) can never succeed: drop it.
      // Anything else (the cluster unreachable) is kept for another try.
      if (e instanceof CalimeroError && e.status < 500) dropInvite();
      setError(`The invitation could not be accepted: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
      setStatus(null);
      signedIn.after();
    }
  }, [signedIn, invite, navigate]);

  const ready =
    api.session.status === 'signed-out' || api.session.status === 'signed-in';
  if (!invite || !ready || signInOpen) return null;

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
          You&apos;re invited to Mero Sign
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
            Not now
          </button>
          {signedIn ? (
            <button
              type="button"
              className={styles.btn}
              onClick={() => void join()}
              disabled={busy}
              data-testid="invitation-join"
            >
              {busy ? <span className={styles.spinner} /> : null}
              {busy ? 'Joining…' : 'Join'}
            </button>
          ) : (
            <button
              type="button"
              className={styles.btn}
              onClick={openSignIn}
              data-testid="invitation-signin"
            >
              Sign in to join
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
