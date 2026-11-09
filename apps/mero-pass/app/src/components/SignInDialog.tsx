import { useRef } from 'react';
import { useCalimero } from '../calimero';
import { useDialogOpen } from '../hooks/useDialogOpen';
import { signInTitle } from '../lib/inviteLink';
import styles from './InviteModal.module.css';
import { CloseIcon } from './icons';
import SignInPanel from './SignInPanel';

/**
 * The landing page's sign-in dialog. Its body is `SignInPanel`, shared with
 * the invitation page. Replaces mero-react's node picker.
 */
export default function SignInDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useDialogOpen(dialogRef, open);
  const { cancelSignUp } = useCalimero();
  // Closing the sign-in mid sign-up ends it, so nothing waits on a click.
  const close = () => {
    cancelSignUp?.();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={close}
      aria-label="Sign in"
      data-testid="sign-in"
    >
      <div className={styles.body}>
        <div className={styles.head}>
          <h2 className={styles.title}>{signInTitle()}</h2>
          <button
            type="button"
            className={styles.close}
            onClick={close}
            aria-label="Close"
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <SignInPanel />
      </div>
    </dialog>
  );
}
