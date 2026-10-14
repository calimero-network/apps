import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';
import { Lock, LockUnlock } from '@calimero-network/mero-icons';

import { useSignOut } from '../auth/signOut';
import { useAutoLockMinutes, useDeviceUnlocked } from '../hooks/useDeviceLock';
import { NARROW_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { ShellNavContext, useShellNav } from '../hooks/useShellNav';
import { deviceKeeper } from '../lib/deviceKey';
import frame from '../styles/frame.module.css';
import ThemeToggle from './ThemeToggle';
import {
  BackIcon,
  CloseIcon,
  LogOutIcon,
  MenuIcon,
  ShieldIcon,
  VaultsIcon,
} from './icons';

/**
 * Render `children` in the rail when there is one, `fallback` in place when
 * there is not (a phone with the drawer shut).
 */
export function InRail({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { slot } = useShellNav();
  return slot ? createPortal(children, slot) : <>{fallback}</>;
}

/**
 * The app frame every signed-in screen shares, in the fleet's glass: a
 * floating frosted rail on the left (the mark, where you can go, the vault's
 * own navigation, and who you are with Lock and Log out), and a column with a
 * slim glass top bar over the page.
 *
 * On a phone there is no rail. The top bar's menu button opens the same rail as
 * a drawer, portalled to <body> so no blurred ancestor can become its
 * containing block.
 *
 * ⚠️ Nothing in the rail or the top bar may hold a `position: fixed` child:
 * both carry `backdrop-filter`, which makes them the containing block for one.
 * Dialogs are native `<dialog>`s (the top layer), the drawer is a portal.
 */
export default function AppShell({
  back,
  crumb,
  children,
}: {
  /** A back affordance, when this screen is inside something. */
  back?: { label: string; to: string };
  /** Where you are, in the top bar. */
  crumb?: string;
  children: ReactNode;
}) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // Going somewhere closes the drawer; so does widening past it.
  useEffect(() => setNavOpen(false), [pathname, narrow]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const closeNav = useCallback(() => setNavOpen(false), []);
  const nav = useMemo(() => ({ slot, closeNav }), [slot, closeNav]);

  return (
    <ShellNavContext.Provider value={nav}>
      <div className={frame.frame}>
        {!narrow && (
          <aside className={frame.rail} aria-label="Mero Pass">
            <Rail slotRef={setSlot} />
          </aside>
        )}

        <div className={frame.column}>
          <header className={frame.topbar}>
            {narrow && (
              <button
                type="button"
                className={frame.iconBtn}
                onClick={() => setNavOpen(true)}
                aria-label="Open navigation"
                aria-expanded={navOpen}
                data-testid="mobile-nav-btn"
              >
                <MenuIcon size={18} />
              </button>
            )}
            {back && (
              <button
                type="button"
                className={frame.back}
                onClick={() => navigate(back.to)}
                data-testid="back"
              >
                <BackIcon size={15} />
                <span>{back.label}</span>
              </button>
            )}
            {crumb ? (
              <span className={frame.crumb} title={crumb}>
                {crumb}
              </span>
            ) : (
              narrow && <span className={frame.crumb}>Mero Pass</span>
            )}
            <div className={frame.topbarEnd}>
              <ThemeToggle className={frame.iconBtn} />
            </div>
          </header>

          {children}
        </div>

        {narrow &&
          navOpen &&
          createPortal(
            <div className={frame.drawer} onClick={closeNav}>
              <div
                className={frame.drawerPanel}
                role="dialog"
                aria-modal="true"
                aria-label="Navigation"
                data-testid="mobile-nav"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={`${frame.iconBtn} ${frame.drawerClose}`}
                  onClick={closeNav}
                  aria-label="Close navigation"
                >
                  <CloseIcon size={18} />
                </button>
                <Rail slotRef={setSlot} />
              </div>
            </div>,
            document.body,
          )}
      </div>
    </ShellNavContext.Provider>
  );
}

/** The rail's content: the same in the column and in the phone drawer. */
function Rail({ slotRef }: { slotRef: (el: HTMLElement | null) => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { nodeUrl } = useMero();
  const unlocked = useDeviceUnlocked();
  const [minutes] = useAutoLockMinutes();
  const signOut = useSignOut();

  // The host only: a scheme and a path are noise here.
  let host = '';
  try {
    host = nodeUrl ? new URL(nodeUrl).host : '';
  } catch {
    host = nodeUrl ?? '';
  }

  const inVaults =
    pathname === '/teams' ||
    pathname.startsWith('/teams/') ||
    pathname.startsWith('/vault/');

  return (
    <div className={frame.railInner}>
      <button
        type="button"
        className={frame.brand}
        onClick={() => navigate('/teams')}
        data-testid="brand"
      >
        <img
          src="/favicon.svg"
          alt=""
          width={32}
          height={32}
          className={frame.brandMark}
        />
        <span className={frame.brandText}>
          <span className={frame.brandName}>Mero Pass</span>
          <span className={frame.brandBy}>by Calimero</span>
        </span>
      </button>

      <nav className={frame.nav} aria-label="Main">
        <NavLink
          to="/teams"
          className={`${frame.navItem} ${inVaults ? frame.navActive : ''}`}
          aria-current={inVaults ? 'page' : undefined}
          data-testid="nav-vaults"
        >
          <VaultsIcon size={18} />
          <span>Vaults</span>
        </NavLink>
        <NavLink
          to="/security"
          className={({ isActive }) =>
            `${frame.navItem} ${isActive ? frame.navActive : ''}`
          }
          data-testid="security"
        >
          <ShieldIcon size={18} />
          <span>Security</span>
        </NavLink>
      </nav>

      {/* A page's own navigation lands here (see `InRail`). */}
      <div ref={slotRef} className={frame.slot} />

      <div className={frame.railFoot}>
        <div
          className={`${frame.lockCard} ${unlocked ? frame.lockOpen : ''}`}
          data-testid="lock-state"
        >
          <span className={frame.lockGlyph} aria-hidden="true">
            {unlocked ? <LockUnlock size={16} /> : <Lock size={16} />}
          </span>
          <span className={frame.lockText}>
            <span className={frame.lockTitle}>
              {unlocked ? 'Unlocked' : 'Locked'}
            </span>
            <span className={frame.lockSub}>
              {unlocked
                ? `Auto-lock · ${minutes === 60 ? '1 hour' : `${minutes} min`}`
                : 'Vault keys cleared'}
            </span>
          </span>
          {unlocked && (
            <button
              type="button"
              className={frame.lockBtn}
              onClick={() => deviceKeeper.lock()}
              title="Clear vault keys from memory"
              data-testid="lock-now"
            >
              Lock
            </button>
          )}
        </div>

        <div className={frame.me}>
          <span className={frame.avatar} aria-hidden="true">
            {(host[0] ?? 'n').toUpperCase()}
          </span>
          <span className={frame.meText}>
            <span className={frame.meName}>Signed in</span>
            <span className={frame.meNode} title={nodeUrl ?? ''}>
              {host || 'this node'}
            </span>
          </span>
          <button
            type="button"
            className={frame.logout}
            onClick={signOut}
            data-testid="logout"
          >
            <LogOutIcon size={15} />
            <span>Log out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
