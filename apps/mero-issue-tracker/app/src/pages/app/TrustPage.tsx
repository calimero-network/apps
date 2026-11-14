import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { instancePackage, type InstancePackage } from '@calimero-apps/connect';
import { WorkspaceTrust } from '@calimero-apps/passkey';
import { tokens as t } from '../../theme';
import { useSignedIn } from '../../sessionContext';
import { useAppCtx } from './appContext';

/** What the open repo runs: `undefined` while asked, `null` for no signed release (a raw bundle, or unreadable). */
function useRunningRelease(): InstancePackage | null | undefined {
  const { client } = useSignedIn();
  const { ws } = useAppCtx();
  const [running, setRunning] = useState<InstancePackage | null | undefined>(undefined);
  useEffect(() => {
    setRunning(undefined);
    if (!ws.activeRepo) return;
    let live = true;
    void instancePackage(client, ws.activeRepo).then((found) => live && setRunning(found));
    return () => { live = false; };
  }, [client, ws.activeRepo]);
  return running;
}

/** What the open workspace's app can do and where it runs, for the release its repo runs. */
export default function TrustPage(): React.ReactElement {
  const { ws } = useAppCtx();
  const running = useRunningRelease();
  return (
    <Wrap>
      <Card data-testid="trust-page">
        {running && ws.activeRepo ? (
          <WorkspaceTrust release={{ package: running.package, version: running.version }} appId={ws.activeRepo} />
        ) : (
          <p className="note">
            {running === undefined
              ? 'Reading the release this repository runs...'
              : 'No signed release to review: this repository runs a local bundle, or its release could not be read from this node.'}
          </p>
        )}
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
  .note { margin: 0; font-size: 13px; line-height: 1.55; color: ${t.color.text2}; }
  @media (max-width: 720px) { padding: 16px; }
`;
