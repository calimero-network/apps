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
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (signInOpen && api.session.status === 'signed-in') closeSignIn();
  }, [signInOpen, api.session.status, closeSignIn]);

  if (!signInOpen) return null;

  const where =
    api.session.status === 'signed-out' || api.session.status === 'signed-in'
      ? describeTarget(api.session.target)
      : null;

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
        <h2 className={styles.modalTitle} id="signin-title">
          {invited ? "You're invited" : 'Sign in to Mero Sign'}
        </h2>
        <p className={styles.modalDesc}>
          {invited
            ? 'Sign in, or create an account, to join the workspace you were invited to. '
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
