/**
 * RECIPE: 1:1 direct messages as app instances reachable by two accounts.
 * Reference code; copy into app/src/hooks/.
 */
import { useCallback, useEffect, useState } from 'react';
import { appTarget, listAppInfos, type AppSource, type ClientRoutes } from '@calimero-apps/connect';

export interface Dm {
  appId: string;
  other: string;
}

type Client = ClientRoutes<{ apps: 'list' | 'get' | 'create' | 'metadata' }>;

export function useDms(client: Client, source: AppSource, org: string | null, self: string) {
  const [dms, setDms] = useState<Dm[]>([]);

  const refresh = useCallback(async () => {
    if (!org) return setDms([]);
    const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
    const apps = (await listAppInfos(client, filter)).filter((a) => a.org === org);
    const out: Dm[] = [];
    for (const a of apps) {
      const meta = (await client.apps.get({ app: a.appId })).metadata as
        { dm?: boolean; a?: string; b?: string } | undefined;
      if (meta?.dm && (meta.a === self || meta.b === self)) {
        out.push({ appId: a.appId, other: meta.a === self ? (meta.b as string) : (meta.a as string) });
      }
    }
    setDms(out);
  }, [client, source, org, self]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** The DM with `other`, created on first use. */
  const openDm = useCallback(
    async (other: string): Promise<string> => {
      if (!org) throw new Error('no organization');
      const existing = dms.find((d) => d.other === other);
      if (existing) return existing.appId;
      const [a, b] = [self, other].sort() as [string, string];
      const { appId } = await client.apps.create({
        name: `dm:${a}:${b}`,
        ...appTarget(source),
        org,
        access: { kind: 'accounts', accounts: [other] },
      });
      await client.apps.metadata({ app: appId, metadata: { dm: true, a, b } });
      await refresh();
      return appId;
    },
    [client, source, org, self, dms, refresh],
  );

  return { dms, openDm, refresh };
}
