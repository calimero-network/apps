import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { LISTING, describeTarget, type SessionApi } from "../session";
import type { PendingInvite } from "../lib/streams";
import { StatusNote } from "./ui";
import { BrandMark } from "./icons";
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
  onNotNow,
}: {
  api: SessionApi;
  /** An invitation link that was opened: said here, redeemed after sign-in. */
  invite?: PendingInvite | null;
  /** Back to the landing page, keeping the invitation for later. */
  onNotNow?: () => void;
}) {
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
                  You&apos;ve been invited to join{" "}
                  {invite.name ? <strong>{invite.name}</strong> : "a stream"} in
                  Mero Stream.{" "}
                </>
              ) : null}
              Accounts are passkeys: nothing to remember, nothing to leak.
              {where ? ` Connected to ${where}.` : ""}
            </p>
          </div>
        </div>

        {session.status === "listing" && <AppListing {...LISTING} />}
        {session.status === "unconfigured" && (
          <StatusNote tone="error" testId="signin-unconfigured">
            {session.message}
          </StatusNote>
        )}

        {session.status === "signed-out" && (
          <div style={{ maxWidth: 360 }}>
            <PasskeySignIn api={api} joining="the stream" />
          </div>
        )}

        {onNotNow && (
          <div style={{ maxWidth: 360 }}>
            <button
              type="button"
              className={styles.crumbLink}
              onClick={onNotNow}
              data-testid="invitation-not-now"
            >
              Not now
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
