// Memoized MeroDocsClient factory - same shape as useRegistryClient but
// scoped to a folder's docs context rather than the namespace-wide
// registry. Returns null until all three inputs resolve so consumers
// can gate rendering on the client being ready.
//
// Its calls go through the event hub (`track`), so the events they commit
// reach the editor marked as its own: what they changed is in the answer.

import { useMemo } from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { useMero } from '@/calimero/react';
import type { EventHub } from '@/calimero/live';
import { MeroDocsClient } from '@/lib/docsApi';
import type { AppTransport } from '@/generated/client';

/** `client` with every call's events marked as this tab's own in `events`. */
export function trackedTransport(client: CalimeroClient, events: Pick<EventHub, 'track'>): AppTransport {
  return {
    apps: {
      call: (...args: Parameters<CalimeroClient['apps']['call']>) =>
        events.track(args[0].app, client.apps.call(...args)),
      view: (...args: Parameters<CalimeroClient['apps']['view']>) => client.apps.view(...args),
    },
    events: (app: string, from?: number, signal?: AbortSignal) => client.events(app, from, signal),
  };
}

export function useDocsClient(
  docsContextId: string | null,
  executorPublicKey: string | null,
): MeroDocsClient | null {
  const { mero } = useMero();
  return useMemo(() => {
    if (!mero || !docsContextId || !executorPublicKey) return null;
    return new MeroDocsClient(trackedTransport(mero.client, mero.events), docsContextId);
  }, [mero, docsContextId, executorPublicKey]);
}
