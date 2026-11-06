import { useSessionApi } from "../sessionContext";
import SignInPanel from "./SignInPanel";
import styles from "./InviteModal.module.css";

/**
 * What an invite link opened while signed out lands on: the invitation itself,
 * as a page, instead of the landing hero with the invite hidden behind a
 * button. The content is the sign-in popup's (`SignInPanel`), so signing in or
 * creating an account here is the same passkey flow; once a session exists the
 * join prompt (`InvitationPrompt`) takes over. "Not now" goes to the landing
 * page and keeps the token, so the invite is still waiting at the next sign-in.
 */
export default function InvitationPage({ onNotNow }: { onNotNow: () => void }) {
  const { api } = useSessionApi();
  return (
    <main className={styles.page} data-testid="invitation-page">
      <section className={`${styles.dialog} ${styles.card}`} aria-labelledby="invitation-page-title">
        <div className={styles.body}>
          <SignInPanel invited titleId="invitation-page-title" />
          <button
            type="button"
            className="ui-btn"
            onClick={onNotNow}
            disabled={api.busy}
            data-testid="invitation-not-now"
          >
            Not now
          </button>
        </div>
      </section>
    </main>
  );
}
