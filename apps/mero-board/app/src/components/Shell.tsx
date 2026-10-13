import React from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import Sidebar, { type SidebarProps } from './Sidebar';
import Topbar from './Topbar';

/** App frame: sidebar rail + main column (topbar over the routed view). */
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
  return (
    <Grid>
      <Sidebar {...sidebar} />
      <Main>
        <Topbar
          onNewIssue={onNewIssue}
          repoName={repoName}
          repoUrl={repoUrl}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          searchInputRef={searchInputRef}
        />
        {children}
      </Main>
    </Grid>
  );
}

const Grid = styled.div`
  font-family: ${t.font.sans};
  font-size: 13px;
  line-height: 1.45;
  color: ${t.color.text};
  background: ${t.color.bg};
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
  max-width: 100vw;
  overflow-x: hidden;
  font-variant-ligatures: none;
  -webkit-font-smoothing: antialiased;
  a { color: inherit; text-decoration: none; }
  @media (max-width: 940px) { grid-template-columns: 1fr; }
`;
const Main = styled.main`
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: ${t.color.bg};
  height: 100vh;
`;
