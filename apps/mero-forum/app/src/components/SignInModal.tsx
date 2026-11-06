import { useEffect, useRef } from "react";
import { useSessionApi } from "../sessionContext";
import { useDialogOpen } from "../hooks/useDialogOpen";
import styles from "./InviteModal.module.css";
import { XIcon } from "./icons";
import SignInPanel from "./SignInPanel";

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * connect dialog (local node discovery, a node URL, the Cloud wallet): on
 * Calimero 1.0 the frontend already knows its cluster (merod local in dev, the
 * Cloud cluster in production) and the account is a passkey.
 */
export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useSessionApi();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useDialogOpen(dialogRef, open);

  useEffect(() => {
    if (open && api.session.status === "signed-in") onClose();
  }, [open, api.session.status, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current && !api.busy) onClose();
      }}
      data-testid="signin-modal"
      aria-labelledby="signin-title"
    >
      <div className={styles.body}>
        <SignInPanel
          titleId="signin-title"
          close={
            <button
              type="button"
              className={styles.close}
              onClick={() => !api.busy && onClose()}
              aria-label="Close"
              title="Close"
            >
              <XIcon size={20} />
            </button>
          }
        />
      </div>
    </dialog>
  );
}
