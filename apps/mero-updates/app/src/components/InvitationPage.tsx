import { SignInBody } from "./SignInDialog";
import styles from "./InviteModal.module.css";

/**
 * What a signed-out visitor sees when they open an invitation link: the
 * invitation itself, as a page, in place of the landing page's hero. Before
 * this they got the generic landing page with a dialog over it.
 *
 * The body is the sign-in dialog's (`SignInBody`), so the copy and the passkey
 * flow are the same in both. Signing in or up here keeps the token; once the
 * session exists `InvitationPrompt` asks "Join?" straight away, and the route
 * the link pointed at is still the address, because nothing here navigated.
 *
 * "Not now" shows the ordinary landing page and keeps the token, so signing in
 * later from there still offers the join.
 */
export default function InvitationPage({ onNotNow }: { onNotNow: () => void }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        boxSizing: "border-box",
      }}
    >
      <section className={styles.dialog} aria-labelledby="invitation-page-title" data-testid="invitation-page">
        <SignInBody titleId="invitation-page-title">
          <button type="button" className="secondary" onClick={onNotNow} data-testid="invitation-not-now">
            Not now
          </button>
        </SignInBody>
      </section>
    </main>
  );
}
