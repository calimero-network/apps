import React from 'react';
import styled from 'styled-components';
import { WorkspaceTrust } from '@calimero-apps/passkey';
import { tokens as t } from '../../theme';
import { useSignedIn } from '../../sessionContext';
import { useAppCtx } from './appContext';

/** What the open workspace's app can do and where it runs, for the release its repo runs. */
export default function TrustPage(): React.ReactElement {
  const { source } = useSignedIn();
  const { ws } = useAppCtx();
  return (
    <Wrap>
      <Card data-testid="trust-page">
        {ws.activeRepo && <WorkspaceTrust appId={ws.activeRepo} source={source} />}
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
