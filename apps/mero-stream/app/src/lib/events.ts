import type { CalimeroClient } from "@calimero-network/mero-js";
import { type ClientRoutes } from "@calimero-apps/connect";

type EventClient = Pick<CalimeroClient, "events"> &
  ClientRoutes<{ apps: "view" }>;

/**
 * Calls `onEvent(kind)` for every event the room emits from now on, until the
 * returned stop. v1 subscribed through mero-react's `useSubscription` (SSE on
 * the node); here it is `client.events`, started just after the log index a
 * first read reports, so the room's history is not replayed.
 *
 * Events are nudges ("read again"), so a dropped stream is not fatal: every
 * caller also polls.
 */
export function subscribeEvents(
  client: EventClient,
  app: string,
  onEvent: (kind: string, data: unknown) => void,
): () => void {
  const abort = new AbortController();
  void (async () => {
    try {
      const { index } = await client.apps.view({
        app,
        method: "getStats",
        args: {},
      });
      for await (const event of client.events(app, index + 1, abort.signal)) {
        onEvent(event.kind, event.data);
      }
    } catch {
      // Closed (sign-out, page left, network): the poll still runs.
    }
  })();
  return () => abort.abort();
}
