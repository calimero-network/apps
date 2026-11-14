// The workspace's Trust section: what its app can do and where it runs, for
// the release the workspace's registry instance runs now, not the one the
// page was built for.

import React, { useEffect, useState } from 'react';
import { instancePackage } from '@calimero-apps/connect';
import { WorkspaceTrust, type ReviewRelease } from '@calimero-apps/passkey';
import { useSession } from '@/calimero/session';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';

export function WorkspaceTrustPanel() {
  const { registryContextId } = useDriveWorkspace();
  const { session } = useSession();
  const client = session.status === 'signed-in' ? session.client : null;
  const [running, setRunning] = useState<{
    app: string;
    release: ReviewRelease | null;
  } | null>(null);

  useEffect(() => {
    if (!client || !registryContextId) return;
    let live = true;
    void instancePackage(client, registryContextId).then((found) => {
      if (!live) return;
      const release =
        found && typeof found.version === 'string'
          ? { package: found.package, version: found.version }
          : null;
      setRunning({ app: registryContextId, release });
    });
    return () => {
      live = false;
    };
  }, [client, registryContextId]);

  if (!registryContextId || running?.app !== registryContextId) return null;
  return (
    <section
      aria-label="Trust"
      className="rounded-lg border border-border bg-card px-4 py-3"
    >
      {running.release ? (
        <WorkspaceTrust release={running.release} appId={registryContextId} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Could not read the release this workspace runs.
        </p>
      )}
    </section>
  );
}
