import { useEffect, useState } from 'react';
import type { ReviewRelease } from '@calimero-apps/passkey';
import { useSession } from '@/calimero/session';

/** What a new workspace's instance will be created from, for its review. */
export type ReleaseToCreate =
  | { status: 'loading' }
  | { status: 'ready'; release: ReviewRelease }
  | { status: 'failed' }
  // A development bundle is a hash, not a published release: nothing signed to review.
  | { status: 'bundle' };

/** The package release the app's source creates instances from: the pinned version, else the newest the node has. */
export function useReleaseToCreate(): ReleaseToCreate {
  const { session, source } = useSession();
  const client = session.status === 'signed-in' ? session.client : null;
  const [resolved, setResolved] = useState<ReleaseToCreate>({
    status: 'loading',
  });
  const pkg = typeof source === 'string' ? null : source.package;
  const pinned = typeof source === 'string' ? undefined : source.version;
  useEffect(() => {
    if (!pkg) return;
    if (pinned) {
      setResolved({
        status: 'ready',
        release: { package: pkg, version: pinned },
      });
      return;
    }
    if (!client) {
      setResolved({ status: 'failed' });
      return;
    }
    let live = true;
    setResolved({ status: 'loading' });
    client.packages.get({ package: pkg }).then(
      ({ latest }) =>
        live &&
        setResolved({
          status: 'ready',
          release: { package: pkg, version: latest },
        }),
      () => live && setResolved({ status: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [client, pkg, pinned]);
  return pkg ? resolved : { status: 'bundle' };
}
