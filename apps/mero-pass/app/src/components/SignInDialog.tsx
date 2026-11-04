import { useRef } from 'react';
import { AppListing, PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import { LISTING, useCalimero } from '../calimero';
import { useDialogOpen } from '../hooks/useDialogOpen';
import styles from './InviteModal.module.css';
import shell from '../styles/shell.module.css';
import { CloseIcon } from './icons';

/**
 * Sign in with a passkey, or make an account with a new one. Replaces
 * mero-react's node picker: there is no node URL to type, the app connects to
 * merod local in development and to its Calimero Cloud cluster in production.
 */
export default function SignInDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const api = useCalimero();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useDialogOpen(dialogRef, open);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-label="Sign in"
      data-testid="sign-in"
    >
      <div className={styles.body}>
        <div className={styles.head}>
          <h2 className={styles.title}>Sign in</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={16} />
          </button>
        </div>
        {api.status === 'listing' ? (
          <AppListing {...LISTING} />
        ) : api.status === 'unconfigured' ? (
          <p className={shell.error} data-testid="sign-in-unconfigured">
            {api.message}
          </p>
        ) : (
          <>
            <p className={shell.sectionHint}>
              {api.where ? `Connected to ${api.where}. ` : 'Connecting… '}
              Your account is a passkey: nothing to remember, nothing to leak.
            </p>
            {api.status === 'signed-out' && <PasskeySignIn api={api} askName />}
          </>
        )}
      </div>
    </dialog>
  );
}
