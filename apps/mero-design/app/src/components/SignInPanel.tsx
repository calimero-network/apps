import type { ReactNode } from "react";
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { PRODUCT_NAME } from "../config";
import { LISTING, describeTarget } from "../session";
import { useSessionApi } from "../sessionContext";
import styles from "./InviteModal.module.css";

/**
 * The body of the sign-in: a title, what an account is, the cluster it is on,
 * and "Continue with passkey" / "Create a passkey". One component for the
 * sign-in popup and the invitation page, so the two never say different
 * things or run different ceremonies.
 *
 * `invited` switches the copy to the invitation's: the visitor came to join a
 * team, and signing in (or creating an account) is how they accept.
 */
export default function SignInPanel({
  invited,
  titleId,
  aside,
}: {
  invited: boolean;
  titleId: string;
  /** Rendered beside the title: the popup's close button. */
  aside?: ReactNode;
}) {
  const { api } = useSessionApi();
  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <>
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {invited ? "You're invited" : "Sign in"}
        </h2>
        {aside}
      </div>
      <p className={styles.desc} data-testid="signin-desc">
        {invited
          ? `You've been invited to join a team in ${PRODUCT_NAME}. Sign in or create an account to accept. `
          : ""}
        Accounts are passkeys: nothing to remember, nothing to leak.
        {where ? ` Connected to ${where}.` : ""}
      </p>

      {api.session.status === "connecting" && <p className={styles.muted}>Connecting…</p>}
      {api.session.status === "listing" && <AppListing {...LISTING} />}
      {api.session.status === "unconfigured" && (
        <p className={styles.error} role="alert">
          {api.session.message}
        </p>
      )}

      {api.session.status === "signed-out" && <PasskeySignIn api={api} />}
    </>
  );
}
