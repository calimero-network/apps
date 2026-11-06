import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { LISTING, describeTarget } from "../../../../api/session";
import { useSessionApi } from "../../../../api/sessionContext";
import styles from "../username-modal/username-modal.module.scss";

/**
 * The body of the sign-in: a title, what an account is, the cluster it is on,
 * and "Continue with passkey" / "Create a passkey". One component for the
 * sign-in popup and the invitation page, so the two never say different
 * things or run different ceremonies.
 */
export default function SignInPanel({ invited, titleId }: { invited: boolean; titleId?: string }) {
  const { api } = useSessionApi();
  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in"
      ? describeTarget(api.session.target)
      : null;

  return (
    <>
      <h2 id={titleId} className={styles.title}>
        {invited ? "You're invited" : "Sign in"}
      </h2>
      <p className={styles.sub} data-testid="signin-desc">
        {invited
          ? "You've been invited to join a team in Mero Calendar. Sign in or create an account to accept. "
          : ""}
        Accounts are passkeys: nothing to remember, nothing to leak.
        {where ? ` Connected to ${where}.` : ""}
      </p>

      {api.session.status === "connecting" && <p className={styles.sub}>Connecting…</p>}
      {api.session.status === "listing" && <AppListing {...LISTING} />}
      {api.session.status === "unconfigured" && (
        <p className={styles.sub} role="alert">
          {api.session.message}
        </p>
      )}

      {api.session.status === "signed-out" && <PasskeySignIn api={api} />}
    </>
  );
}
