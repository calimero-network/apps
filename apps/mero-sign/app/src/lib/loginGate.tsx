/**
 * The passkey sign-in dialog, mounted once. Replaces v1's node picker: on
 * Calimero 1.0 the frontend already knows its cluster (merod local in dev,
 * the Cloud cluster in production) and the account is a passkey, so the only
 * choices are signing in with one or creating an account with a new one.
 *
 * Opened by `useCalimero().login()` from the landing CTA, the signed-out app
 * routes and the header.
 */
import { useEffect } from 'react';
import { AppListing, PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import { LISTING, describeTarget } from '../session';
import { useSessionApi } from '../sessionContext';
import { pendingInvite } from './invites';
import styles from '../pages/app/AgreementsPage.module.css';

export function SignInModal() {
  const { api, signInOpen, closeSignIn } = useSessionApi();

  useEffect(() => {
    if (signInOpen && api.session.status === 'signed-in') closeSignIn();
  }, [signInOpen, api.session.status, closeSignIn]);

  if (!signInOpen) return null;

  return (
    <div
      className={styles.modalBackdrop}
      onClick={() => !api.busy && closeSignIn()}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        data-testid="signin-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <SignInBody titleId="signin-title" />

        <div className={styles.modalRow}>
          <button
            type="button"
            className={styles.btnGhost}
            disabled={api.busy}
            onClick={closeSignIn}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The sign-in itself: title, explanation, the cluster it talks to, and
 * "Continue with passkey" / "Create a passkey". Shared by the dialog above and
 * the invitation page a signed-out visitor sees when they open an invite link
 * (`InvitationPage`), so the copy and the passkey flow cannot drift apart.
 */
export function SignInBody({ titleId }: { titleId: string }) {
  const { api } = useSessionApi();
  const invited = pendingInvite() !== null;
  const where =
    api.session.status === 'signed-out' || api.session.status === 'signed-in'
      ? describeTarget(api.session.target)
      : null;

  return (
    <>
      <h2 className={styles.modalTitle} id={titleId}>
        {invited ? "You're invited" : 'Sign in to Mero Sign'}
      </h2>
      <p className={styles.modalDesc}>
        {invited
          ? "You've been invited to join a workspace in Mero Sign. Sign in or create an account to accept. "
          : ''}
        Accounts are passkeys: nothing to remember, nothing to leak.
        {where ? ` Connected to ${where}.` : ''}
      </p>

      {api.session.status === 'connecting' && (
        <p className={styles.hint}>Connecting…</p>
      )}
      {api.session.status === 'listing' && <AppListing {...LISTING} />}
      {api.session.status === 'unconfigured' && (
        <p className={styles.error} role="alert">
          {api.session.message}
        </p>
      )}

      {api.session.status === 'signed-out' && <PasskeySignIn api={api} />}
    </>
  );
}
