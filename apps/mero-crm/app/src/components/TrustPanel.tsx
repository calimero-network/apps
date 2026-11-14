import { useEffect, useState } from 'react';
import { instancePackage, type ReleaseClient } from '@calimero-apps/connect';
import { WorkspaceTrust, type ReviewRelease } from '@calimero-apps/passkey';

import { Panel } from './ui';

type Running = { appId: string; release: ReviewRelease | null };

/** Settings "Trust": the shared review of the release the open pipeline runs. */
export default function TrustPanel({ client, appId }: { client: ReleaseClient; appId: string }) {
  const [running, setRunning] = useState<Running | null>(null);
  useEffect(() => {
    let live = true;
    void instancePackage(client, appId).then((pkg) => {
      const release = pkg?.package && pkg.version ? { package: pkg.package, version: pkg.version } : null;
      if (live) setRunning({ appId, release });
    });
    return () => {
      live = false;
    };
  }, [client, appId]);

  if (running?.appId !== appId) return null;
  return (
    <Panel data-testid="trust-settings">
      {running.release ? (
        <WorkspaceTrust release={running.release} appId={appId} />
      ) : (
        <>
          <h3>Trust</h3>
          <p className="help">This pipeline does not run a published release, so there is no signed review to show.</p>
        </>
      )}
    </Panel>
  );
}
