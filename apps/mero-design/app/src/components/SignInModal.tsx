import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSessionApi } from "../sessionContext";
import { pendingInvite } from "../utils/inviteLink";
import SignInPanel from "./SignInPanel";
import styles from "./InviteModal.module.css";

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * connect dialog (a node URL, the Cloud wallet, desktop SSO): on Calimero 1.0
 * the frontend already knows its cluster (merod local in dev, the Cloud
 * cluster in production) and the account is a passkey.
 */
export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useSessionApi();
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (open && api.session.status === "signed-in") onClose();
  }, [open, api.session.status, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !api.busy) {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, api.busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !api.busy) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="signin-title" data-testid="signin-modal">
        <SignInPanel
          invited={invited}
          titleId="signin-title"
          aside={
            <button className={styles.close} onClick={() => !api.busy && onClose()} aria-label="Close">
              ✕
            </button>
          }
        />
      </div>
    </div>,
    document.body,
  );
}
