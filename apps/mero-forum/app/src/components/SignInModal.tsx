import { useEffect, useRef, useState } from "react";

import { describeTarget } from "../session";
import { useSessionApi } from "../sessionContext";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { pendingInvite } from "../lib/spaces";
import styles from "./InviteModal.module.css";
import { XIcon } from "./icons";

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * connect dialog (local node discovery, a node URL, the Cloud wallet): on
 * Calimero 1.0 the frontend already knows its cluster (merod local in dev, the
 * Cloud cluster in production) and the account is a passkey.
 */
export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useSessionApi();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [name, setName] = useState("");
  const invited = pendingInvite() !== null;
  useDialogOpen(dialogRef, open);

  useEffect(() => {
    if (open && api.session.status === "signed-in") onClose();
  }, [open, api.session.status, onClose]);

  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current && !api.busy) onClose();
      }}
      data-testid="signin-modal"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <button
            type="button"
            className={styles.close}
            onClick={() => !api.busy && onClose()}
            aria-label="Close"
            title="Close"
          >
            <XIcon size={20} />
          </button>
          <h2 className={styles.title}>{invited ? "You're invited" : "Sign in"}</h2>
        </header>
        <p className={styles.hint}>
          {invited ? "Sign in, or create an account, to join the space you were invited to. " : ""}
          Accounts are passkeys: nothing to remember, nothing to leak.
          {where ? ` Connected to ${where}.` : ""}
        </p>

        {api.session.status === "connecting" && <p className={styles.hint}>Connecting…</p>}
        {api.session.status === "unconfigured" && (
          <p className={styles.hint} role="alert">
            {api.session.message}
          </p>
        )}

        {api.session.status === "signed-out" && (
          <>
            <button
              type="button"
              className={styles.primary}
              data-testid="signin-passkey"
              disabled={api.busy}
              onClick={() => void api.signIn()}
            >
              {api.busy ? "Waiting for your passkey…" : "Sign in with a passkey"}
            </button>
            <label className={styles.hint} htmlFor="signup-name">
              New here? Your name
            </label>
            <input
              id="signup-name"
              className={styles.link}
              data-testid="signup-name"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) void api.signUp(name.trim());
              }}
              disabled={api.busy}
            />
            <button
              type="button"
              className="ui-btn"
              data-testid="signup-passkey"
              disabled={api.busy || !name.trim()}
              onClick={() => void api.signUp(name.trim())}
            >
              Create an account
            </button>
          </>
        )}

        {api.error && (
          <p className={styles.hint} role="alert" data-testid="signin-error">
            {api.error}
          </p>
        )}
      </div>
    </dialog>
  );
}
