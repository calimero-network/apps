import React from 'react';
import {
  Navbar as MeroNavbar,
  NavbarMenu,
} from '@calimero-network/mero-ui';

interface NavBarProps {
  namespaceName?: string | null;
  namespaceId?: string | null;
  /** Accepted but no longer rendered — see the note in the centre menu. */
  contextId?: string | null;
  /** Accepted but no longer rendered — see the note in the centre menu. */
  currentUser?: string | null;
  onLogout: () => void;
  extra?: React.ReactNode;
}

export default function NavBar({
  namespaceName, namespaceId, onLogout, extra,
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
      {/* Not a link. It was one, back to the landing page, which meant the
          one fixed point in the bar moved you off the app when clicked. The
          mark is identity; the footer carries the way to the landing page. */}
      <div className="nav-brand">
        <img src="/favicon.svg" alt="" width={26} height={26} className="nav-brand-mark" />
        <span className="nav-brand-text">Battleships</span>
      </div>
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
        {/* ⚠️ NOT wrapped in mero-ui's `NavbarItem`. That component paints a
            dark slate hover by ASSIGNING `e.currentTarget.style.backgroundColor`
            in an `onMouseEnter` handler — a runtime inline style, which no
            stylesheet can override short of `!important`, and which is a colour
            from the library's dark theme. The button is its own control; it
            needs no wrapper. */}
        <button type="button" className="nav-logout" onClick={onLogout}>
          Logout
        </button>
      </NavbarMenu>
    </MeroNavbar>
  );
}
