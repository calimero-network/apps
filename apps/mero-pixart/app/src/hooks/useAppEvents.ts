import { useEffect, useRef } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";

/** How long to wait before opening the stream again after it closed. */
const RECONNECT_MS = 3_000;

/**
 * Runs `onEvent` for every event the document emits from now on, and
 * `onReconnect` each time the stream is opened again after it closed (what
 * changed meanwhile arrives as no event at all). Replaces v1's SSE subscription
 * (mero-react's event client): here it is `client.events`, started after the
 * log index a first read reports, so the document's history is not replayed.
 */
export function useAppEvents(
  client: Pick<CalimeroClient, "events" | "view"> | null,
  app: string | null,
  onEvent: (kind: string, data: unknown) => void,
  onReconnect?: () => void,
): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!client || !app) return;
    const abort = new AbortController();
    void (async () => {
      let first = true;
      while (!abort.signal.aborted) {
        try {
          const { index } = await client.view(app, "getDocument", {});
          if (!first) onReconnectRef.current?.();
          first = false;
          for await (const event of client.events(app, index + 1, abort.signal)) {
            onEventRef.current(event.kind, event.data);
          }
        } catch {
          // Closed or unreachable: try again shortly, unless we were stopped.
        }
        if (abort.signal.aborted) break;
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
    })();
    return () => abort.abort();
  }, [client, app]);
}
