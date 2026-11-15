import type { ReviewRelease } from '@calimero-apps/passkey';
import { useSession } from '@/calimero/session';

/** What a new workspace's instance will be created from, for its review. */
export type ReleaseToCreate =
  | { status: 'loading' }
  | { status: 'ready'; release: ReviewRelease }
  // A development bundle, or a release that could not be read: nothing signed to review.
  | { status: 'none' };

/** The release the session's source creates instances from, the one the review shows. */
export function useReleaseToCreate(): ReleaseToCreate {
  const { source, resolvingSource } = useSession();
  if (resolvingSource) return { status: 'loading' };
  if (typeof source === 'string' || !source.version) return { status: 'none' };
  return { status: 'ready', release: { package: source.package, version: source.version } };
}
