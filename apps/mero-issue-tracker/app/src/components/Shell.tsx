import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styled, { keyframes } from 'styled-components';
import { useLocation } from 'react-router-dom';
import { tokens as t } from '../theme';
import { NARROW_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import Sidebar, { type SidebarProps } from './Sidebar';
import Topbar from './Topbar';

/**
 * App frame: sidebar rail + main column (topbar over the routed view).
 *
 * On a narrow screen there is no rail; the top bar's menu button opens the same
 * sidebar as a drawer. Only one of the two is ever mounted, so every nav test
 * id exists once on the page.
 */
export default function Shell({
  sidebar,
  repoName,
  repoUrl,
  onNewIssue,
  searchQuery,
  onSearchChange,
  searchInputRef,
  children,
}: {
  sidebar: SidebarProps;
  repoName: string | null;
  repoUrl: string;
  onNewIssue: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  children: React.ReactNode;
}): React.ReactElement {
  const narrow = useMediaQuery(NARROW_QUERY);
  const [navOpen, setNavOpen] = useState(false);
  const { pathname, search } = useLocation();

  // Going somewhere closes the drawer; so does widening the window past it.
  useEffect(() => { setNavOpen(false); }, [pathname, search, narrow]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <Grid>
      {!narrow && <Sidebar {...sidebar} />}
      <Main>
        <Topbar
          onOpenNav={narrow ? () => setNavOpen(true) : undefined}
          onNewIssue={onNewIssue}
          repoName={repoName}
          repoUrl={repoUrl}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          searchInputRef={searchInputRef}
        />
        {children}
      </Main>
      {/* Portalled to <body>: nothing in the frame (the blurred rail and top
          bar included) can become its containing block. */}
      {narrow && navOpen && createPortal(
        <Drawer onClick={() => setNavOpen(false)}>
          <div className="panel" role="dialog" aria-modal="true" aria-label="Navigation" data-testid="mobile-nav" onClick={(e) => e.stopPropagation()}>
            <Sidebar {...sidebar} variant="drawer" onPicked={() => setNavOpen(false)} />
          </div>
        </Drawer>,
        document.body,
      )}
    </Grid>
  );
}

const Grid = styled.div`
  font-family: ${t.font.sans};
  font-size: 13px;
  line-height: 1.45;
  color: ${t.color.text};
  /* The page: the glass ground under this app's tinted colour fields. */
  background-color: ${t.color.bg};
  background-image: var(--glass-fields);
  background-attachment: fixed;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  min-height: 100vh;
  max-width: 100vw;
  overflow-x: hidden;
  font-variant-ligatures: none;
  -webkit-font-smoothing: antialiased;
  a { color: inherit; text-decoration: none; }
  @media (max-width: 940px) { grid-template-columns: minmax(0, 1fr); }
`;
const Main = styled.main`
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: transparent;
  height: 100vh;
  height: 100dvh;
`;
const fade = keyframes`from{opacity:0;}to{opacity:1;}`;
const slide = keyframes`from{transform:translateX(-16px);opacity:0;}to{transform:none;opacity:1;}`;
const Drawer = styled.div`
  position: fixed; inset: 0; z-index: 90; background: ${t.color.scrim};
  font-family: ${t.font.sans}; font-size: 13px; line-height: 1.45; color: ${t.color.text};
  animation: ${fade} 0.15s ease both;
  a { color: inherit; text-decoration: none; }
  .panel {
    position: absolute; top: 10px; bottom: 10px; left: 10px; width: min(300px, calc(100vw - 56px));
    animation: ${slide} 0.18s ease both;
  }
  @media (prefers-reduced-motion: reduce) { &, .panel { animation: none; } }
`;
