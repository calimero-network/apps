import { useEffect, useMemo, useState } from 'react';
import { servedRelease, type AppSource } from '@calimero-apps/connect';
import type { CalimeroClient } from '@calimero-network/mero-js';

export interface ResolvedSource {
  source: AppSource;
  /** The newest release is being read: do not create an instance or review yet. */
  resolving: boolean;
}

/**
 * `base` pinned to one release, so a new workspace is reviewed and created from
 * the same version: the one `base` names, else the newest the signed-in client
 * may see, else the release this page is served from, else none (unreviewed).
 */
export function useResolvedSource(
  base: AppSource,
  client: CalimeroClient | null,
  href: string = globalThis.location?.href ?? '',
): ResolvedSource {
  const pkg = typeof base === 'string' ? null : base.package;
  const named = typeof base === 'string' ? undefined : base.version;
  const [read, setRead] = useState<{
    client: CalimeroClient;
    version: string | null;
  } | null>(null);
  useEffect(() => {
    if (!pkg || named || !client) return;
    let live = true;
    client.packages.get({ package: pkg }).then(
      ({ latest }) => live && setRead({ client, version: latest }),
      () => live && setRead({ client, version: servedRelease(href) }),
    );
    return () => {
      live = false;
    };
  }, [client, pkg, named, href]);

  return useMemo(() => {
    if (!pkg || named || !client) return { source: base, resolving: false };
    if (read?.client !== client) return { source: base, resolving: true };
    return {
      source: read.version ? { package: pkg, version: read.version } : base,
      resolving: false,
    };
  }, [base, pkg, named, client, read]);
}
