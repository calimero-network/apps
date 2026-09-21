import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import { useCalimero } from '../lib/node';
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

/**
 * The node this session is talking to, shortened to its host.
 *
 * ⚠️ THIS READOUT WAS PERMANENTLY BLANK. It read `getAppEndpointKey()`, which
 * had been reduced to `return null` when this app moved to mero-js — the SDK
 * owns the node URL now — so the one diagnostic the old connect chrome was
 * kept for displayed nothing, and the `try/catch` around it meant it did so
 * silently. `useMero().nodeUrl` is where the URL actually lives.
 */
function useNodeHost(): string {
  const { nodeUrl } = useMero();
  if (!nodeUrl) return '';
  try {
    return new URL(nodeUrl).host;
  } catch {
    // A stored value that is not a URL: show nothing rather than a raw string.
    return '';
  }
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
        onClick={() => navigate('/workspaces')}
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
