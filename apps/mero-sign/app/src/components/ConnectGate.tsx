import { Link } from 'react-router-dom';
import { PlugZap } from 'lucide-react';
import { useCalimero } from '../lib/useCalimero';
import { AppShell } from './shell/AppShell';
import shell from './shell/AppShell.module.css';
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
//
// ⚠️ THE SECOND CONNECT SCREEN. #128 made the landing page's "Sign in"
// open the node picker directly, and missed this one — so the app still had a
// screen whose whole content was "the button is in the top right of the landing
// page" above a link that sent you there to look for it. Three navigations to
// reach one picker, and it threw away the destination it had just promised to
// keep. It now opens the same picker, in place, for the same reason: the picker
// is the dialog, and `useCalimero().login()` is what opens it.

export default function ConnectGate({ what }: { what: string }) {
  const { login } = useCalimero();

  return (
    <AppShell
      bare
      actions={
        <Link className={shell.topLink} to="/landing">
          What is this?
        </Link>
      }
    >
      <main className={styles.main}>
        <section className={`${styles.panel} ${styles.gate}`}>
          <span className={styles.gateIcon}>
            <PlugZap size={26} />
          </span>
          <h1 className={styles.title}>Connect your node</h1>
          <p className={styles.subtitle}>
            {what} lives on your own Calimero node. Connect one and you will
            come straight back here.
          </p>
          <div className={styles.joinRow}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => login()}
              data-testid="connect-cta"
            >
              Connect
            </button>
            <Link className={styles.btnGhost} to="/landing">
              What is Mero Sign?
            </Link>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
