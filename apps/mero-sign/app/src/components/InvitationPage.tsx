import { Link } from 'react-router-dom';
import { SignInBody } from '../lib/loginGate';
import { AppShell } from './shell/AppShell';
import shell from './shell/AppShell.module.css';
import styles from '../pages/app/AgreementsPage.module.css';

// ── What a signed-out visitor sees when they open an invitation link ─────────
//
// The invitation itself, as a page, in place of whatever the link's route
// would have shown (the landing page's hero, or `ConnectGate`). Before this
// they got the generic page with a "You're invited" dialog over it.
//
// The body is the sign-in dialog's (`SignInBody`), so the copy and the passkey
// flow are the same in both. Rendered, NOT redirected, like `ConnectGate`: the
// address is still the deep link once they are signed in, and then
// `InvitationHandlerPopup` asks "Join?" straight away.
//
// "Not now" shows the ordinary page and keeps the token, so signing in later
// still offers the join.

export default function InvitationPage({ onNotNow }: { onNotNow: () => void }) {
  return (
    <AppShell
      bare
      actions={
        <Link className={shell.topLink} to="/landing" onClick={onNotNow}>
          What is this?
        </Link>
      }
    >
      <main className={styles.main}>
        <section
          className={`${styles.panel} ${styles.gate}`}
          aria-labelledby="invitation-page-title"
          data-testid="invitation-page"
        >
          <SignInBody titleId="invitation-page-title" />
          <div className={styles.modalRow}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={onNotNow}
              data-testid="invitation-not-now"
            >
              Not now
            </button>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
