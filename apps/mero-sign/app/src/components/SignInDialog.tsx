import { useState } from 'react';
import GlassDialog from './ui/GlassDialog';
import type { SessionApi } from '../lib/session';
import { describeTarget } from '../lib/session';
import styles from '../pages/app/AgreementsPage.module.css';

/**
 * Passkey sign-in, or a new account with a new passkey. What the node picker
 * and the hosted login were in v1: an account is a passkey now, on the local
 * nodes in development and on the Cloud cluster in production.
 */
export default function SignInDialog({
  open,
  onClose,
  session,
}: {
  open: boolean;
  onClose: () => void;
  session: SessionApi;
}) {
  const [name, setName] = useState('');
  const s = session.session;
  const where =
    s.status === 'signed-out' || s.status === 'signed-in'
      ? describeTarget(s.target)
      : null;
  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      title="Sign in to Mero Sign"
      description={
        where
          ? `Connected to ${where}. Your account is a passkey: nothing to remember, nothing to leak.`
          : s.status === 'unconfigured'
            ? 'This build cannot connect.'
            : 'Connecting…'
      }
      testId="sign-in-dialog"
    >
      {s.status === 'unconfigured' && <pre className={styles.error}>{s.message}</pre>}
      {s.status === 'signed-out' && (
        <>
          <div className={styles.joinRow}>
            <button
              type="button"
              className={styles.btn}
              disabled={session.busy}
              onClick={() => void session.signIn()}
              data-testid="sign-in"
            >
              Sign in with a passkey
            </button>
          </div>
          <form
            className={styles.createRow}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void session.signUp(name.trim());
            }}
          >
            <input
              className={styles.input}
              placeholder="Your name"
              aria-label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="submit"
              className={styles.btnGhost}
              disabled={session.busy || !name.trim()}
              data-testid="sign-up"
            >
              Create an account
            </button>
          </form>
        </>
      )}
      {session.error && <p className={styles.error}>{session.error}</p>}
    </GlassDialog>
  );
}
