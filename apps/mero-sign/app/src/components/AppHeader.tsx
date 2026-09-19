import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAppEndpointKey, useCalimero } from '../lib/node';
import styles from '../pages/app/AgreementsPage.module.css';

// ── The application shell ────────────────────────────────────────────────────
//
// mero-design's header: 56px, white, one bottom hairline, brand on the left,
// logout on the right, and nothing else. It replaces four components:
//
//   * `Sidebar.tsx` — a 280px left rail holding two links and a
//     `<CalimeroConnectButton />`. The button rendered the whole connection
//     state to somebody who was, by construction, already connected: it only
//     appeared once you were signed in.
//   * `MobileHeader.tsx` — a fixed bar whose only job was a hamburger that
//     opened the rail.
//   * `MobileLayout.tsx` — the wrapper that held the two together, and which
//     also wrapped the unauthenticated catch-all, which is how the sidebar and
//     the routing bug came to be the same change.
//   * `CalimeroConnectionRequired.tsx` — a full screen for a sentence.
//
// Two links do not need a rail. The node host is kept, small and grey, because
// "which node am I on" is the one thing the connect chrome displayed that was
// worth displaying — but as a diagnostic, not as a control.

/** The node this session is talking to, shortened to its host. */
function useNodeHost(): string {
  const [host, setHost] = useState('');
  useEffect(() => {
    try {
      const url = getAppEndpointKey();
      setHost(url ? new URL(url).host : '');
    } catch {
      setHost('');
    }
  }, []);
  return host;
}

export function AppHeader({ back }: { back?: { label: string; to: string } }) {
  const navigate = useNavigate();
  const { logout } = useCalimero();
  const host = useNodeHost();

  return (
    <header className={styles.header}>
      {back && (
        <button
          className={styles.logoutBtn}
          onClick={() => navigate(back.to)}
          data-testid="back"
          style={{ border: 'none', background: 'none', padding: '6px 0' }}
        >
          ← {back.label}
        </button>
      )}
      <button
        className={styles.logo}
        onClick={() => navigate('/agreements')}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          marginLeft: back ? 12 : 0,
        }}
      >
        <span className={styles.mark}>M</span> Mero Sign
      </button>
      <div className={styles.headerRight}>
        {host && (
          <span className={styles.nodeHost} title={host}>
            {host}
          </span>
        )}
        <button
          className={styles.logoutBtn}
          onClick={() => logout?.()}
          data-testid="logout"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
