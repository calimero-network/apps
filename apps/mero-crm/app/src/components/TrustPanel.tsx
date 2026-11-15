import { useEffect, useState } from 'react';
import { instancePackage, type ReleaseClient } from '@calimero-apps/connect';
import { WorkspaceTrust, type ReviewRelease } from '@calimero-apps/passkey';

import { Button, Panel } from './ui';

/** What was read for `appId`: the release it runs (`null`: none published), or that the read failed. */
type Read = { appId: string; release: ReviewRelease | null } | { appId: string; failed: true };

/** Settings "Trust": the shared review of the release the open pipeline runs. */
export default function TrustPanel({ client, appId }: { client: ReleaseClient; appId: string }) {
  const [read, setRead] = useState<Read | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    instancePackage(client, appId).then(
      (running) => {
        const release = running?.package && running.version ? { package: running.package, version: running.version } : null;
        if (live) setRead({ appId, release });
      },
      () => live && setRead({ appId, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [client, appId, round]);

  if (read?.appId !== appId) return null;
  return (
    <Panel data-testid="trust-settings">
      {'failed' in read ? (
        <>
          <h3>Trust</h3>
          <p className="help">This pipeline's release could not be read, so its review is not shown.</p>
          <Button onClick={() => { setRead(null); setRound((n) => n + 1); }}>Try again</Button>
        </>
      ) : read.release ? (
        <WorkspaceTrust release={read.release} appId={appId} />
      ) : (
        <>
          <h3>Trust</h3>
          <p className="help">This pipeline does not run a published release, so there is no signed review to show.</p>
        </>
      )}
    </Panel>
  );
}
