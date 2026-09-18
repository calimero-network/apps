import { Link } from 'react-router-dom';
import styles from '../pages/app/AgreementsPage.module.css';

// ── What a signed-out visitor sees on an app route ───────────────────────────
//
// Replaces `CalimeroConnectionRequired.tsx`, which was a full screen — heading,
// icon, card, bullet list — for one sentence and one action.
//
// Rendered, NOT redirected. A signed-out visitor who opens a link to
// `/agreements/abc` stays at `/agreements/abc`; the connect prompt stands in for
// the page, and once they are signed in the page they asked for is the page they
// get. Redirecting them to `/` would lose the destination, and a redirect is
// also the shape that was reported looping — see `src/routes.ts`.

export default function ConnectGate({ what }: { what: string }) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <span className={styles.mark}>M</span> Mero Sign
        </span>
        <div className={styles.headerRight}>
          <Link className={styles.logoutBtn} to="/landing">
            What is this?
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Connect your node</h1>
        <p className={styles.subtitle}>
          {what} lives on your own Calimero node. Connect one to open it — the
          button is in the top right of the landing page, and the app will bring
          you straight back here.
        </p>
        <div className={styles.createRow}>
          <Link className={styles.btn} to="/landing" data-testid="connect-cta">
            Go to the landing page
          </Link>
        </div>
      </main>
    </div>
  );
}
