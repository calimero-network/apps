import { useEffect } from "react";
import { createPortal } from "react-dom";
import { PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { describeTarget } from "../session";
import { useSessionApi } from "../sessionContext";
import { pendingInvite } from "../utils/inviteLink";
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

  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !api.busy) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="signin-title" data-testid="signin-modal">
        <div className={styles.header}>
          <h2 id="signin-title" className={styles.title}>{invited ? "You're invited" : "Sign in"}</h2>
          <button className={styles.close} onClick={() => !api.busy && onClose()} aria-label="Close">
            ✕
          </button>
        </div>
        <p className={styles.desc}>
          {invited ? "Sign in, or create an account, to join the team you were invited to. " : ""}
          Accounts are passkeys: nothing to remember, nothing to leak.
          {where ? ` Connected to ${where}.` : ""}
        </p>

        {api.session.status === "connecting" && <p className={styles.muted}>Connecting…</p>}
        {api.session.status === "unconfigured" && (
          <p className={styles.error} role="alert">
            {api.session.message}
          </p>
        )}

        {api.session.status === "signed-out" && <PasskeySignIn api={api} />}
      </div>
    </div>,
    document.body,
  );
}
