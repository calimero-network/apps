/**
 * The open workbook's events, live: replaces mero-react's `useSubscription`
 * and the SSE reconnect hook.
 *
 * `client.events(app, from)` streams the app's committed events from log index
 * `from`, then live ones. The stream starts at the index a view answered at,
 * so it never replays history the first read already holds. When it drops
 * (the cluster restarted, the laptop slept), the hook reports itself offline,
 * retries, and once the cluster answers again calls `onReconnect` so the page
 * re-reads what changed while it was away.
 */
import { useEffect, useRef, useState } from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import type { AppEvent } from '../spreadsheet/events';
import { type ClientRoutes } from '@calimero-apps/connect';

/** How long to wait before retrying a dropped stream. */
const RETRY_MS = 2_000;

export function useAppEvents(
  client: (Pick<CalimeroClient, 'events'> & ClientRoutes<{ apps: 'view' }>) | null,
  appId: string | null,
  onEvent: (event: AppEvent) => void,
  onReconnect: () => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(true);
  const handlers = useRef({ onEvent, onReconnect });
  handlers.current = { onEvent, onReconnect };

  useEffect(() => {
    if (!client || !appId) return undefined;
    const abort = new AbortController();
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        abort.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    void (async () => {
      let first = true;
      while (!abort.signal.aborted) {
        try {
          // Where the state a read sees ends: events after it are news.
          const { index } = await client.apps.view({ app: appId, method: 'whoami', args: {} });
          if (abort.signal.aborted) return;
          setConnected(true);
          if (!first) handlers.current.onReconnect();
          first = false;
          for await (const event of client.events(appId, index + 1, abort.signal)) {
            handlers.current.onEvent({ kind: event.kind, data: event.data });
          }
        } catch {
          // Dropped or unreachable: retried below.
        }
        if (abort.signal.aborted) return;
        setConnected(false);
        first = false;
        await sleep(RETRY_MS);
      }
    })();
    return () => abort.abort();
  }, [client, appId]);

  return { connected };
}
