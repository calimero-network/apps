import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import {
  ArrowLeft,
  FileSignature,
  Layers,
  LogOut,
  Menu,
  PenLine,
  X,
} from 'lucide-react';

import { useSignOut } from '../../auth/signOut';
import ThemeToggle from './ThemeToggle';
import styles from './AppShell.module.css';

// ── The application shell ────────────────────────────────────────────────────
//
// The fleet's glass frame: a frosted rail on the left (brand, the three places
// in the app, and who you are signed in as, with Log out), and a frosted top
// bar over the content (the way back, and the light/dark switch). On a phone
// the rail folds into a drawer the top bar's menu button opens.
//
// ⚠️ NOTHING THAT FLOATS LIVES INSIDE THE RAIL OR THE TOP BAR. Both use
// `backdrop-filter`, and an element with a backdrop-filter (or a filter or a
// transform) becomes the containing block of every `position: fixed`
// descendant — a dialog rendered inside one is laid out in the bar's box, not
// the viewport. Pages render their dialogs in `children`, which sit in the
// plain content column, and the phone drawer is portalled to <body>.

interface Back {
  label: string;
  to: string;
}

/**
 * The node this session is talking to, shortened to its host.
 *
 * `useMero().nodeUrl` is where the URL lives — the SDK owns it since the move
 * to mero-js; the old `getAppEndpointKey()` readout returned null and showed
 * nothing.
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

const NAV = [
  {
    id: 'workspaces',
    label: 'Workspaces',
    to: '/workspaces',
    icon: Layers,
    active: (path: string) => path === '/workspaces' || path === '/',
  },
  {
    id: 'agreements',
    label: 'Agreements',
    // The agreements of whichever workspace is open; with none open the
    // screen itself says to pick one.
    to: '/agreements',
    icon: FileSignature,
    active: (path: string) =>
      path.startsWith('/workspaces/') || path.startsWith('/agreements'),
  },
  {
    id: 'signatures',
    label: 'Signatures',
    to: '/signatures',
    icon: PenLine,
    active: (path: string) => path.startsWith('/signatures'),
  },
] as const;

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className={styles.mark}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <PenLine size={Math.round(size * 0.5)} strokeWidth={2.4} />
    </span>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return (
    <nav className={styles.nav} aria-label="Mero Sign">
      {NAV.map(({ id, label, to, icon: Icon, active }) => {
        const on = active(pathname);
        return (
          <Link
            key={id}
            to={to}
            className={`${styles.navItem} ${on ? styles.navActive : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={onNavigate}
            data-testid={`nav-${id}`}
          >
            <Icon size={18} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Who is signed in, and the way out. In the rail and in the phone drawer. */
function Identity() {
  const host = useNodeHost();
  const signOut = useSignOut();
  return (
    <div className={styles.identity}>
      <div className={styles.identityRow}>
        <span className={styles.avatar} aria-hidden="true">
          {(host || 'node').slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.identityText}>
          <span className={styles.identityLabel}>Signed in to</span>
          <span className={styles.identityHost} title={host || undefined}>
            {host || 'your node'}
          </span>
        </span>
      </div>
      <button
        type="button"
        className={styles.logout}
        onClick={signOut}
        data-testid="logout"
      >
        <LogOut size={16} />
        Log out
      </button>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/workspaces" className={styles.brand} aria-label="Mero Sign home">
      <BrandMark />
      <span className={styles.brandText}>
        <span className={styles.brandName}>Mero Sign</span>
        <span className={styles.brandSub}>Signatures, peer to peer</span>
      </span>
    </Link>
  );
}

function MobileNav({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className={styles.drawerScrim} onClick={onClose}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        data-testid="mobile-nav"
        aria-label="Navigation"
      >
        <div className={styles.drawerHead}>
          <Brand />
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <NavList onNavigate={onClose} />
        <div className={styles.spacer} />
        <Identity />
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Everything a signed-in screen sits in. `back` puts a way back in the top
 * bar; `bare` is the signed-out frame (connect screen, not-found): no rail, no
 * identity, the brand in the top bar and whatever `actions` the screen offers.
 */
export function AppShell({
  children,
  back,
  bare = false,
  actions,
}: {
  children: ReactNode;
  back?: Back;
  bare?: boolean;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const host = useNodeHost();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Where you are, for the top bar of a screen with no way back.
  const section = bare ? undefined : NAV.find((n) => n.active(pathname));

  // A navigation closes the drawer, however it happened.
  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <div className={`${styles.shell} ${bare ? styles.shellBare : ''}`}>
      {!bare && (
        <aside className={styles.rail}>
          <div className={styles.railInner}>
            <Brand />
            <NavList />
            <div className={styles.spacer} />
            <Identity />
          </div>
        </aside>
      )}

      <div className={styles.column}>
        <header className={styles.topbar}>
          {!bare && (
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.menuBtn}`}
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              data-testid="mobile-nav-btn"
            >
              <Menu size={18} />
            </button>
          )}
          <span
            className={`${bare ? styles.topBrandAlways : styles.topBrand} ${
              back ? styles.topBrandCompact : ''
            }`}
          >
            <Link to={bare ? '/landing' : '/workspaces'} className={styles.brandInline}>
              <BrandMark size={28} />
              <span className={styles.brandName}>Mero Sign</span>
            </Link>
          </span>
          {back && (
            <button
              type="button"
              className={styles.back}
              onClick={() => navigate(back.to)}
              data-testid="back"
            >
              <ArrowLeft size={16} />
              <span>{back.label}</span>
            </button>
          )}
          {!back && section && (
            <span className={styles.crumb}>
              <section.icon size={17} />
              {section.label}
            </span>
          )}
          <div className={styles.topRight}>
            {!bare && host && (
              <span className={styles.nodeChip} title={`Connected to ${host}`}>
                <span className={styles.nodeDot} aria-hidden="true" />
                {host}
              </span>
            )}
            {actions}
            <ThemeToggle />
          </div>
        </header>

        {children}
      </div>

      {drawerOpen && <MobileNav onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}
