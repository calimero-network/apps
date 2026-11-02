import { useEffect, useState } from "react";

import { pendingInvite } from "../api/teams";
import { describeTarget } from "../session";
import { useSessionApi } from "../sessionContext";
import styles from "./InviteModal.module.css";

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * connect dialog (local node discovery, a node URL, the Cloud wallet): on
 * Calimero 1.0 the frontend already knows its cluster (merod local in dev, the
 * Cloud cluster in production) and the account is a passkey.
 */
export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useSessionApi();
  const [name, setName] = useState("");
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (open && api.session.status === "signed-in") onClose();
  }, [open, api.session.status, onClose]);

  if (!open) return null;

  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <div className="mp-overlay" onClick={() => !api.busy && onClose()} data-testid="signin-overlay">
      <div className={`mp-modal ${styles.modal}`} onClick={(e) => e.stopPropagation()} data-testid="signin-modal">
        <div className={styles.header}>
          <h2 className={styles.title}>{invited ? "You're invited" : "Sign in"}</h2>
          <button className={styles.close} onClick={() => !api.busy && onClose()} aria-label="Close">✕</button>
        </div>
        <p className={styles.desc}>
          {invited ? "Sign in, or create an account, to join the team you were invited to. " : ""}
          Accounts are passkeys: nothing to remember, nothing to leak.
          {where ? ` Connected to ${where}.` : ""}
        </p>

        {api.session.status === "connecting" && <p className={styles.desc}>Connecting…</p>}
        {api.session.status === "unconfigured" && (
          <p className={styles.error} role="alert">{api.session.message}</p>
        )}

        {api.session.status === "signed-out" && (
          <>
            <button
              type="button"
              className="mp-btn mp-btn--primary"
              data-testid="signin-passkey"
              disabled={api.busy}
              onClick={() => void api.signIn()}
            >
              {api.busy ? "Waiting for your passkey…" : "Sign in with a passkey"}
            </button>
            <label className="mp-label" htmlFor="signup-name">New here? Your name</label>
            <input
              id="signup-name"
              className="mp-input"
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
              className="mp-btn"
              data-testid="signup-passkey"
              disabled={api.busy || !name.trim()}
              onClick={() => void api.signUp(name.trim())}
            >
              Create an account
            </button>
          </>
        )}

        {api.error && (
          <p className={styles.error} role="alert" data-testid="signin-error">{api.error}</p>
        )}
      </div>
    </div>
  );
}
