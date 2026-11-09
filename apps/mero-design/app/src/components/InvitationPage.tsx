import { useSessionApi } from "../sessionContext";
import SignInPanel from "./SignInPanel";
import styles from "./InviteModal.module.css";

/**
 * What a signed-out visitor sees when they open an invitation link: the
 * invitation itself, as the whole page, with the passkey sign-in on it. No
 * landing hero behind it and no extra click: joining is what they came for.
 *
 * "Not now" goes on to the ordinary landing page and keeps the token, so
 * signing in later from there still offers the invitation.
 */
export default function InvitationPage({ onNotNow }: { onNotNow: () => void }) {
  const { api } = useSessionApi();
  return (
    <main className={styles.page} data-testid="invitation-page">
      <div className={styles.modal} role="region" aria-labelledby="invitation-page-title">
        <SignInPanel invited titleId="invitation-page-title" />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onNotNow}
            disabled={api.busy}
            data-testid="invitation-not-now"
          >
            Not now
          </button>
        </div>
      </div>
    </main>
  );
}
