/**
 * Live updates for an open agreement: its event stream (a document uploaded,
 * signed or deleted, someone joining or leaving) re-reads what the screen
 * shows, so a peer's change shows without a reload.
 *
 * The stream starts after the log index a view answers at, so opening an
 * agreement never replays its history: the screen's first read holds it.
 * A dropped stream reopens and re-reads; when the node answers that this
 * account may no longer reach the agreement (403, 404) it stops and says so.
 */
import { useEffect, useRef } from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';

/** How long to wait before reopening a dropped stream. */
const RECONNECT_MS = 2_000;
/** Events come in bursts (an upload is several writes): one re-read per burst. */
const SETTLE_MS = 250;

/** Whether `error` is the node refusing this account the instance (403) or not knowing it (404). */
export function accessLost(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 403 || status === 404;
}

export interface AgreementEventsSession {
  client: Pick<CalimeroClient, 'apps' | 'events'>;
  after?: () => void;
}

export function useAgreementEvents(
  session: AgreementEventsSession | null,
  contextId: string | null,
  onChange: () => void,
  onLost?: () => void,
): void {
  const handlers = useRef({ onChange, onLost });
  handlers.current = { onChange, onLost };
  const client = session?.client ?? null;
  const after = session?.after;

  useEffect(() => {
    if (!client || !contextId) return undefined;
    const abort = new AbortController();
    let settle: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(settle);
      settle = setTimeout(() => handlers.current.onChange(), SETTLE_MS);
    };
    const open = async (reconnect: boolean) => {
      // Missed while the stream was down: re-read instead of replaying.
      if (reconnect) changed();
      try {
        // Where the state a read sees ends: events after it are news.
        const { index } = await client.apps.view({ app: contextId, method: 'whoami', args: {} });
        if (abort.signal.aborted) return;
        for await (const _event of client.events(contextId, index + 1, abort.signal)) {
          changed();
        }
      } catch (e) {
        if (!abort.signal.aborted && accessLost(e)) {
          handlers.current.onLost?.();
          return;
        }
        // Dropped: reopened below, unless unmounting.
      } finally {
        after?.();
      }
      if (!abort.signal.aborted) retry = setTimeout(() => void open(true), RECONNECT_MS);
    };
    void open(false);
    return () => {
      abort.abort();
      clearTimeout(settle);
      clearTimeout(retry);
    };
  }, [client, contextId, after]);
}
