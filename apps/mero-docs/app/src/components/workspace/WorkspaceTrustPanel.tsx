// The workspace's Trust section, for the release its registry instance runs now.

import React, { useCallback, useEffect, useState } from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { instancePackage } from '@calimero-apps/connect';
import { WorkspaceTrust, type ReviewRelease } from '@calimero-apps/passkey';
import { useSession } from '@/calimero/session';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';

type Running =
  | { status: 'release'; release: ReviewRelease }
  | { status: 'none' }
  | { status: 'error' };

/** The release `app` runs: none for an instance of a raw bundle, an error when it cannot be read. */
async function readRunning(
  client: CalimeroClient,
  app: string,
): Promise<Running> {
  try {
    const running = await instancePackage(client, app);
    return running?.package && running.version
      ? {
          status: 'release',
          release: { package: running.package, version: running.version },
        }
      : { status: 'none' };
  } catch {
    return { status: 'error' };
  }
}

export function WorkspaceTrustPanel() {
  const { registryContextId } = useDriveWorkspace();
  const { session } = useSession();
  const client = session.status === 'signed-in' ? session.client : null;
  const [running, setRunning] = useState<{
    app: string;
    found: Running;
  } | null>(null);
  const [round, setRound] = useState(0);
  const retry = useCallback(() => {
    setRunning(null);
    setRound((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!client || !registryContextId) return;
    let live = true;
    void readRunning(client, registryContextId).then((found) => {
      if (live) setRunning({ app: registryContextId, found });
    });
    return () => {
      live = false;
    };
  }, [client, registryContextId, round]);

  if (!registryContextId || running?.app !== registryContextId) return null;
  const { found } = running;
  return (
    <section
      aria-label="Trust"
      className="rounded-lg border border-border bg-card px-4 py-3"
    >
      {found.status === 'release' ? (
        <>
          <WorkspaceTrust release={found.release} appId={registryContextId} />
          <p className="mt-3 text-xs text-muted-foreground">
            This covers the workspace&apos;s shared settings. Open a folder to
            check the code its documents run on, from the node shield.
          </p>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">
          <h2 className="text-lg font-bold text-foreground">Trust</h2>
          {found.status === 'none' ? (
            <p className="mt-1">
              This workspace runs no published release, so there is nothing to
              review.
            </p>
          ) : (
            <>
              <p className="mt-1">
                Could not read the release this workspace runs.
              </p>
              <button
                type="button"
                className="mt-2 font-medium text-primary hover:underline"
                onClick={retry}
              >
                Try again
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
