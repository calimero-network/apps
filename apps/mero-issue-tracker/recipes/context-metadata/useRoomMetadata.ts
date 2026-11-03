/**
 * RECIPE: a room's metadata (title + free key/value data) as app metadata.
 * Reference code; copy into app/src/hooks/. Not compiled as-is.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';

export interface RoomMeta {
  name: string;
  data: Record<string, string>;
}

export function useRoomMetadata(client: Pick<CalimeroClient, 'getApp' | 'setAppMetadata'>, appId: string | null) {
  const [meta, setMetaState] = useState<RoomMeta | null>(null);

  useEffect(() => {
    if (!appId) return;
    let live = true;
    client
      .getApp(appId)
      .then((app) => {
        const m = (app.metadata ?? null) as Partial<RoomMeta> | null;
        if (live) setMetaState(m && typeof m.name === 'string' ? { name: m.name, data: m.data ?? {} } : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, appId]);

  /** The app's owner or an org admin; the node refuses anyone else. */
  const setMeta = useCallback(
    async (next: RoomMeta) => {
      if (!appId) return;
      await client.setAppMetadata(appId, next);
      setMetaState(next);
    },
    [client, appId],
  );

  return { meta, setMeta };
}
