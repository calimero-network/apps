import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import ThemeToggle from './ThemeToggle';
import { ChevronRightIcon, LockIcon, LogOutIcon, ShieldIcon } from './icons';
import { useDeviceUnlocked } from '../hooks/useDeviceLock';
import { deviceKeeper } from '../lib/deviceKey';
import styles from '../styles/shell.module.css';

/**
 * The app bar: the Mero Pass mark, a breadcrumb trail, and a way out. 56px,
 * white, on a hairline — the Calimero apps' shared header.
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
        aria-label="Mero Pass — your vaults"
        data-testid="brand"
      >
        <span className={styles.brandTile} aria-hidden="true">
          <LockIcon size={15} strokeWidth={2} />
        </span>
        <span className={styles.brandName}>Mero Pass</span>
      </button>

      {(back || crumb) && (
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          {back && (
            <button
              type="button"
              className={styles.back}
              onClick={() => navigate(back.to)}
              data-testid="back"
            >
              {back.label}
            </button>
          )}
          {back && crumb && (
            <span className={styles.crumbSep} aria-hidden="true">
              <ChevronRightIcon size={14} />
            </span>
          )}
          {crumb && (
            <span className={styles.crumb} aria-current="page">
              {crumb}
            </span>
          )}
        </nav>
      )}

      <div className={styles.headerRight}>
        {host && (
          <span
            className={styles.nodeChip}
            title={`Connected to ${nodeUrl ?? ''}`}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.nodeChipText}>{host}</span>
          </span>
        )}
        {unlocked && (
          <button
            type="button"
            className={styles.logoutBtn}
            onClick={() => deviceKeeper.lock()}
            title="Lock — clear vault keys from memory"
            aria-label="Lock"
            data-testid="lock-now"
          >
            <LockIcon size={16} className={styles.headerIcon} />
            <span className={styles.headerLabel}>Lock</span>
          </button>
        )}
        <button
          type="button"
          className={styles.logoutBtn}
          onClick={() => navigate('/security')}
          title="Security — recovery key and devices"
          aria-label="Security"
          data-testid="security"
        >
          <ShieldIcon size={16} className={styles.headerIcon} />
          <span className={styles.headerLabel}>Security</span>
        </button>
        <span className={styles.headerDivider} aria-hidden="true" />
        <ThemeToggle />
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
          title="Log out"
          aria-label="Log out"
          data-testid="logout"
        >
          <LogOutIcon size={16} className={styles.headerIcon} />
        </button>
      </div>
    </header>
  );
}
