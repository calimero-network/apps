import { Link } from 'react-router-dom';
import styles from '../pages/app/AgreementsPage.module.css';

// ── The terminal catch-all ───────────────────────────────────────────────────
//
// It RENDERS. It does not redirect, and that is the whole point.
//
// The reported bug was `/landing` spiralling into
// `/landing/?/&/~and~/~and~/…` forever. The live cause is a stale deployment
// serving a GitHub Pages 404 shim (see `src/routes.ts`), but the app used to
// have two nested route tables each with their own `path="*"`, which is the
// shape a client-side loop hides in. One catch-all, rendering a dead end with
// links out, cannot participate in a cycle however it is reached.

export default function NotFound() {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <span className={styles.mark}>M</span> Mero Sign
        </span>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title} data-testid="not-found">
          That page does not exist
        </h1>
        <p className={styles.subtitle}>
          The address you opened is not one this app has. Nothing is wrong with
          your node.
        </p>
        <div className={styles.createRow}>
          <Link className={styles.btn} to="/agreements">
            Your agreements
          </Link>
          <Link className={styles.btnGhost} to="/landing">
            What is Mero Sign?
          </Link>
        </div>
      </main>
    </div>
  );
}
