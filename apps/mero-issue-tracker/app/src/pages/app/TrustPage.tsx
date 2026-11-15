import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { instancePackage, type InstancePackage } from '@calimero-apps/connect';
import { WorkspaceTrust } from '@calimero-apps/passkey';
import { tokens as t } from '../../theme';
import { useSignedIn } from '../../sessionContext';
import { useAppCtx } from './appContext';

type Running =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; release: InstancePackage | null };

/** What the open repo runs, read when it opens; `retry` asks again. */
function useRunningRelease(): [Running, () => void] {
  const { client } = useSignedIn();
  const { ws } = useAppCtx();
  const [running, setRunning] = useState<Running>({ status: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    setRunning({ status: 'loading' });
    if (!ws.activeRepo) return;
    let live = true;
    instancePackage(client, ws.activeRepo).then(
      (release) => live && setRunning({ status: 'ready', release }),
      () => live && setRunning({ status: 'error' }),
    );
    return () => { live = false; };
  }, [client, ws.activeRepo, round]);
  return [running, () => setRound((n) => n + 1)];
}

/** What the open workspace's app can do and where it runs, for the release its repo runs. */
export default function TrustPage(): React.ReactElement {
  const { ws } = useAppCtx();
  const [running, retry] = useRunningRelease();
  return (
    <Wrap>
      <Card data-testid="trust-page">
        {running.status === 'ready' && running.release && ws.activeRepo ? (
          <WorkspaceTrust release={{ package: running.release.package, version: running.release.version }} appId={ws.activeRepo} />
        ) : (
          <>
            <p className="note">
              {running.status === 'loading' && 'Reading the release this repository runs...'}
              {running.status === 'error' && 'The release this repository runs could not be read.'}
              {running.status === 'ready' && 'This repository runs no published release: it uses a local bundle, so there is nothing to review.'}
            </p>
            {running.status === 'error' && <button type="button" className="retry" onClick={retry}>Try again</button>}
          </>
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
  .retry {
    margin-top: 12px; min-height: 36px; padding: 0 16px; font-family: inherit; font-size: 13px; font-weight: 600;
    color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.borderStrong};
    border-radius: ${t.radiusPill}; cursor: pointer;
    &:hover { background: ${t.color.hover}; }
  }
  @media (max-width: 720px) { padding: 16px; }
`;
