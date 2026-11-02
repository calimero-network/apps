/**
 * The passkey sign-in dialog, mounted once. Replaces v1's node picker: on
 * Calimero 1.0 the frontend already knows its cluster (merod local in dev,
 * the Cloud cluster in production) and the account is a passkey, so the only
 * choices are signing in with one or creating an account with a new one.
 *
 * Opened by `useCalimero().login()` from the landing CTA, the signed-out app
 * routes and the header.
 */
import { useEffect, useState } from 'react';

import { describeTarget } from '../session';
import { useSessionApi } from '../sessionContext';
import { pendingInvite } from './invites';
import styles from '../pages/app/AgreementsPage.module.css';

export function SignInModal() {
  const { api, signInOpen, closeSignIn } = useSessionApi();
  const [name, setName] = useState('');
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
        {api.session.status === 'unconfigured' && (
          <p className={styles.error} role="alert">
            {api.session.message}
          </p>
        )}

        {api.session.status === 'signed-out' && (
          <>
            <div className={styles.modalRow}>
              <button
                type="button"
                className={styles.btn}
                data-testid="signin-passkey"
                disabled={api.busy}
                onClick={() => void api.signIn()}
              >
                {api.busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
              </button>
            </div>
            <p className={styles.hint}>New here? Create an account.</p>
            <div className={styles.createRow}>
              <input
                className={styles.input}
                placeholder="Your name…"
                aria-label="Your name"
                data-testid="signup-name"
                value={name}
                maxLength={64}
                disabled={api.busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) void api.signUp(name.trim());
                }}
              />
              <button
                type="button"
                className={styles.btnGhost}
                data-testid="signup-passkey"
                disabled={api.busy || !name.trim()}
                onClick={() => void api.signUp(name.trim())}
              >
                Create an account
              </button>
            </div>
          </>
        )}

        {api.error && (
          <p className={styles.error} role="alert" data-testid="signin-error">
            {api.error}
          </p>
        )}
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
