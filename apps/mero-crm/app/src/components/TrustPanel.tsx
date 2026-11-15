import { useEffect, useState } from 'react';
import type { ReleaseClient } from '@calimero-apps/connect';
import { WorkspaceTrust, type ReviewRelease } from '@calimero-apps/passkey';

import { Button, Panel } from './ui';

/** What was read for `appId`: the release it runs (`null`: none published), or that the read failed. */
type Read = { appId: string; release: ReviewRelease | null } | { appId: string; failed: true };

/** The release `appId` runs, as its scope's report says; throws when the report cannot be read. */
async function runningRelease(client: ReleaseClient, appId: string): Promise<ReviewRelease | null> {
  const record = (await client.apps.get({ app: appId })) as { org?: unknown };
  const org = typeof record.org === 'string' ? record.org : null;
  const running = (await client.appsReportAll(org)).apps.find((a) => a.app === appId)?.package;
  return running?.package && running.version ? { package: running.package, version: running.version } : null;
}

/** Settings "Trust": the shared review of the release the open pipeline runs. */
export default function TrustPanel({ client, appId }: { client: ReleaseClient; appId: string }) {
  const [read, setRead] = useState<Read | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    runningRelease(client, appId).then(
      (release) => live && setRead({ appId, release }),
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
