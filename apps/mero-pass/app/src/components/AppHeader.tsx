import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import styles from '../styles/shell.module.css';

/**
 * The app bar: a mark, a trail, and a way out. 56px on a hairline.
 *
 * ── What was removed, and why ────────────────────────────────────────────────
 *
 * `ConnectButton` was here on every screen. It renders the whole CONNECTION
 * STATE — a node picker, a connect flow, a status — to somebody who is, by
 * definition, already connected, because they could not have reached this
 * screen otherwise. It is chrome that reports a state rather than letting
 * anyone act on one.
 *
 * What a signed-in person actually needs from a header is: where am I, how do I
 * get back, which node is this, and how do I leave. That is the four things
 * below and nothing else. `useMero()` gives `nodeUrl` and `logout` directly, so
 * the whole component is gone rather than replaced.
 *
 * The old `PassNavbar` wrapped mero-ui's `Navbar`/`NavbarBrand`/`NavbarMenu`,
 * which brought its own dark elevated surface into a light app and could not be
 * made to match the rest without fighting it.
 */
export default function AppHeader({
  /** A back affordance, when this screen is inside something. */
  back,
  /** Where you are, after the mark. */
  crumb,
}: {
  back?: { label: string; to: string };
  crumb?: string;
}) {
  const navigate = useNavigate();
  const { nodeUrl, logout } = useMero();

  // The host only. A full URL with a scheme and a port is noise in a header,
  // and on a hosted node it is long enough to push the logout button off.
  let host = '';
  try {
    host = nodeUrl ? new URL(nodeUrl).host : '';
  } catch {
    host = nodeUrl ?? '';
  }

  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.brand}
        onClick={() => navigate('/teams')}
        data-testid="brand"
      >
        {/* Green as a FILL with near-black ink — the one mark on the screen. */}
        <span className={styles.mark} aria-hidden="true">
          ●
        </span>
        Mero Pass
      </button>

      {back && (
        <button
          type="button"
          className={styles.back}
          onClick={() => navigate(back.to)}
          data-testid="back"
        >
          ← {back.label}
        </button>
      )}
      {crumb && <span className={styles.crumb}>{crumb}</span>}

      <div className={styles.headerRight}>
        {host && (
          <span className={styles.nodeChip} title={nodeUrl ?? ''}>
            {host}
          </span>
        )}
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={() => {
            logout();
            navigate('/', { replace: true });
          }}
          data-testid="logout"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
