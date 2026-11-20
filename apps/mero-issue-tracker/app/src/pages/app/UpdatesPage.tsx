import React from 'react';
import styled from 'styled-components';
import { WorkspaceUpdates } from '@calimero-apps/passkey';
import { tokens as t } from '../../theme';
import { useAppCtx } from './appContext';

/** Whether a newer release is available for the open repo, and its approval for an owner or admin of the workspace. */
export default function UpdatesPage(): React.ReactElement {
  const { ws } = useAppCtx();
  const repo = ws.repos.find((r) => r.contextId === ws.activeRepo);
  return (
    <Wrap>
      <Card data-testid="updates-page">
        {ws.activeRepo && <WorkspaceUpdates appId={ws.activeRepo} subject={repo && `the repository ${repo.name}`} />}
      </Card>
    </Wrap>
  );
}

const Wrap = styled.div`
  flex: 1 1 auto; min-height: 0; min-width: 0; overflow-y: auto;
  padding: 18px 16px 56px;
  > * { max-width: 760px; margin-left: auto; margin-right: auto; }
  @media (max-width: 720px) { padding: 12px 10px 40px; }
`;
const Card = styled.div`
  padding: 22px 24px; background: ${t.color.panel}; border: 1px solid ${t.color.edge};
  border-radius: ${t.radiusLg}; box-shadow: ${t.shadowCard};
  @media (max-width: 720px) { padding: 16px; }
`;
