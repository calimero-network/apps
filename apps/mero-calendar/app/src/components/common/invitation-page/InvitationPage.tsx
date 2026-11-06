import { useSessionApi } from "../../../api/sessionContext";
import SignInPanel from "../modals/sign-in-modal/SignInPanel";
import modalStyles from "../modals/username-modal/username-modal.module.scss";
import styles from "./invitation-page.module.scss";

/**
 * What a signed-out visitor sees when they open an invitation link: the
 * invitation itself, as the whole page, with the passkey sign-in on it. No
 * landing hero behind it and no extra click: joining is what they came for.
 *
 * "Not now" goes on to the ordinary landing page and keeps the token, so
 * signing in later from there still joins the team.
 */
export default function InvitationPage({ onNotNow }: { onNotNow: () => void }) {
  const { api } = useSessionApi();
  return (
    <main className={styles.page} data-testid="invitation-page">
      <div className={modalStyles.modal} role="region" aria-labelledby="invitation-page-title">
        <SignInPanel invited titleId="invitation-page-title" />
        <div className={modalStyles.actions}>
          <button
            type="button"
            className="mc-btn mc-btn--ghost"
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
