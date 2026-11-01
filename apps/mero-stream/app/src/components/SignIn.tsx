import { useState } from "react";
import { describeTarget, type SessionApi } from "../session";
import type { PendingInvite } from "../lib/streams";
import { ActionButton, StatusNote } from "./ui";
import { BrandMark, LayersIcon } from "./icons";
import styles from "../pages/Manage.module.css";

/**
 * Passkey sign-in, or a new account with a new passkey.
 *
 * Replaces v1's node login (mero-react's `LoginModal`: a node URL, or a Cloud
 * account through the wallet). Accounts are passkeys on the cluster the app
 * talks to (`merod local` in development, Calimero Cloud in production).
 */
export default function SignIn({
  api,
  invite,
}: {
  api: SessionApi;
  /** An invitation link that was opened: said here, redeemed after sign-in. */
  invite?: PendingInvite | null;
}) {
  const [name, setName] = useState("");
  const { session } = api;
  const where =
    session.status === "signed-out" ? describeTarget(session.target) : null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <BrandMark size={28} />
          <h1 className={styles.brandName}>Mero Stream</h1>
        </div>
      </header>
      <main className={styles.content}>
        <div className={styles.heading}>
          <div className={styles.headingText}>
            <h2 className={styles.title}>
              {invite ? "You're invited" : "Sign in"}
            </h2>
            <p className={styles.subtitle}>
              {invite ? (
                <>
                  Sign in (or create an account) to join{" "}
                  <strong>{invite.name ?? "a stream"}</strong>.{" "}
                </>
              ) : null}
              Accounts are passkeys: nothing to remember, nothing to leak.
              {where ? ` Connected to ${where}.` : ""}
            </p>
          </div>
        </div>

        {session.status === "unconfigured" && (
          <StatusNote tone="error" testId="signin-unconfigured">
            {session.message}
          </StatusNote>
        )}

        <div className={styles.toolbar}>
          <ActionButton
            onClick={() => void api.signIn()}
            pending={api.busy}
            pendingLabel="Waiting for your passkey…"
            disabled={session.status !== "signed-out"}
            testId="signin"
          >
            Sign in with a passkey
          </ActionButton>
        </div>

        <form
          className={styles.toolbar}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void api.signUp(name.trim());
          }}
        >
          <span className={styles.toolbarIcon} aria-hidden="true">
            <LayersIcon size={18} />
          </span>
          <input
            className={styles.input}
            placeholder="Your name"
            aria-label="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            data-testid="signup-name"
          />
          <button
            type="submit"
            className={styles.openBtn}
            disabled={api.busy || !name.trim() || session.status !== "signed-out"}
            data-testid="signup"
          >
            Create an account
          </button>
        </form>

        {api.error && (
          <StatusNote tone="error" testId="signin-error">
            {api.error}
          </StatusNote>
        )}
      </main>
    </div>
  );
}
