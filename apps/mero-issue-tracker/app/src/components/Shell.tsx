import React from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

/** App frame: sidebar rail + main column (topbar over the routed view). */
export default function Shell({
  totalIssues,
  membersCount,
  currentUser,
  currentUserLabel,
  onNewIssue,
  children,
}: {
  totalIssues: number;
  membersCount: number;
  currentUser: string;
  currentUserLabel: string;
  onNewIssue: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Grid>
      <Sidebar
        totalIssues={totalIssues}
        membersCount={membersCount}
        currentUser={currentUser}
        currentUserLabel={currentUserLabel}
      />
      <Main>
        <Topbar onNewIssue={onNewIssue} />
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
