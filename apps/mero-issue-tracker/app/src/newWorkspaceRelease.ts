import { servedRelease, type AppSource, type ClientRoutes } from '@calimero-apps/connect';
import type { ReviewRelease } from '@calimero-apps/passkey';

/** The newest release each client's node had when first asked, so the review and every create use one version. */
const newest = new WeakMap<object, Map<string, string>>();

/**
 * The release new repositories are created from: the version the build names,
 * else the newest the node lists, read once per session; when the node cannot
 * say, the release this page is served from. `null` for a development bundle or
 * when nothing says, which creates without a version and skips the review.
 */
export async function newWorkspaceRelease(
  client: ClientRoutes<{ packages: 'get' }>,
  source: AppSource,
  href: string = window.location.href,
): Promise<ReviewRelease | null> {
  if (typeof source === 'string') return null;
  const { package: pkg } = source;
  if (source.version) return { package: pkg, version: source.version };
  const known = newest.get(client)?.get(pkg);
  if (known) return { package: pkg, version: known };
  try {
    const { latest } = await client.packages.get({ package: pkg });
    if (latest) {
      newest.set(client, (newest.get(client) ?? new Map()).set(pkg, latest));
      return { package: pkg, version: latest };
    }
  } catch {
    /* falls back to the release this page is served from */
  }
  const served = servedRelease(href);
  return served ? { package: pkg, version: served } : null;
}
