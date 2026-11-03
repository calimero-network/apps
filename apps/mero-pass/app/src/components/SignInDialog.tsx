import { useRef, useState } from 'react';

import { useCalimero } from '../calimero';
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
  const [name, setName] = useState('');
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
        {api.status === 'unconfigured' ? (
          <p className={shell.error} data-testid="sign-in-unconfigured">
            {api.message}
          </p>
        ) : (
          <>
            <p className={shell.sectionHint}>
              {api.where ? `Connected to ${api.where}. ` : 'Connecting… '}
              Your account is a passkey: nothing to remember, nothing to leak.
            </p>
            <div className={shell.createRow}>
              <button
                type="button"
                className={shell.btn}
                disabled={api.busy || api.status !== 'signed-out'}
                onClick={() => void api.signIn()}
                data-testid="sign-in-passkey"
              >
                Sign in with a passkey
              </button>
            </div>
            <form
              className={shell.createRow}
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void api.signUp(name.trim());
              }}
            >
              <input
                className={shell.input}
                placeholder="Your name"
                aria-label="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="sign-up-name"
              />
              <button
                type="submit"
                className={shell.btnGhost}
                disabled={
                  api.busy || api.status !== 'signed-out' || !name.trim()
                }
                data-testid="sign-up"
              >
                Create an account
              </button>
            </form>
            {api.error && (
              <p className={shell.error} data-testid="sign-in-error">
                {api.error}
              </p>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
