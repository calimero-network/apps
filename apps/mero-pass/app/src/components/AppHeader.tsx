import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import ThemeToggle from './ThemeToggle';
import Wordmark from './Wordmark';
import { useDeviceUnlocked } from '../hooks/useDeviceLock';
import { deviceKeeper } from '../lib/deviceKey';
import styles from '../styles/shell.module.css';

/**
 * The app bar: the Calimero lockup, a trail, and a way out. 64px on a
 * hairline, the same bar as the Calimero Cloud console.
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
 * which brought its own elevated surface and could not be made to match the
 * rest without fighting it.
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
  const unlocked = useDeviceUnlocked();

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
        <Wordmark size="sm" />
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
        <ThemeToggle />
        {unlocked && (
          <button
            type="button"
            className={styles.logoutBtn}
            onClick={() => deviceKeeper.lock()}
            title="Clear vault keys from memory"
            data-testid="lock-now"
          >
            Lock
          </button>
        )}
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={() => navigate('/security')}
          data-testid="security"
        >
          Security
        </button>
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={() => {
            // Logging out drops the vault keys too: a signed-out tab should
            // hold nothing that opens a vault.
            deviceKeeper.lock();
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
