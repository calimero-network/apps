import React from 'react';
import { Link } from 'react-router-dom';
import {
  Navbar as MeroNavbar,
  NavbarMenu,
  NavbarItem,
  Button,
} from '@calimero-network/mero-ui';

interface NavBarProps {
  namespaceName?: string | null;
  namespaceId?: string | null;
  /** Accepted but no longer rendered — see the note in the centre menu. */
  contextId?: string | null;
  /** Accepted but no longer rendered — see the note in the centre menu. */
  currentUser?: string | null;
  onLogout: () => void;
  onBack?: () => void;
  extra?: React.ReactNode;
}

export default function NavBar({
  namespaceName, namespaceId, onLogout, onBack, extra,
}: NavBarProps) {
  return (
    <MeroNavbar
      variant="elevated"
      size="md"
      /* mero-ui hardcodes a dark bar INLINE (`backgroundColor: "#1A1A1A"`),
         and exposes no CSS variable for it — but it spreads `style` AFTER its
         own base styles, so this wins without `!important`. */
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
        color: 'var(--text-primary)',
      }}
    >
      {onBack ? (
        <NavbarItem>
          <button
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              padding: '0.35rem 0.5rem',
              borderRadius: '6px',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            <span style={{ fontSize: '1rem' }}>&larr;</span>
            Back
          </button>
        </NavbarItem>
      ) : null}
      {/* The mark is the way back to the landing page.
          `state.fromApp` is what gets a signed-in visitor PAST the guard on
          `/` — see RedirectIfAuthed in App.tsx. Router state, not a query
          parameter, so an SSO callback can never carry it. */}
      <Link
        to="/"
        state={{ fromApp: true }}
        className="nav-brand"
        aria-label="Battleships — back to the landing page"
      >
        <img src="/favicon.svg" alt="" width={26} height={26} className="nav-brand-mark" />
        <span className="nav-brand-text">Battleships</span>
      </Link>
      {/* The context id and the node key used to sit here as truncated hex with
          copy buttons. They are debugging values, not navigation: nobody reads
          `19de26…63b75d` at a glance, and they crowded out the one thing the
          bar should show. The lobby's NAME stays — that one means something. */}
      <NavbarMenu align="center">
        {namespaceId && namespaceName && (
          <span className="nav-lobby-name" title={namespaceName}>{namespaceName}</span>
        )}
        {extra}
      </NavbarMenu>
      <NavbarMenu align="right">
        <NavbarItem>
          {/* Same reason as the bar: mero-ui's own colours are tuned for a
              dark surface, and `style` is spread last. */}
          <Button
            variant="secondary"
            onClick={onLogout}
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-medium)',
              boxShadow: 'none',
            }}
          >
            Logout
          </Button>
        </NavbarItem>
      </NavbarMenu>
    </MeroNavbar>
  );
}
