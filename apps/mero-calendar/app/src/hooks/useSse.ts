import { useEffect, useRef } from "react";
import type {
  GroupMembershipEventData,
  GroupMigrationEventData,
  SseEventData,
} from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";

/** How long after a reconnect to wait before re-reading state. */
const RESYNC_DELAY_MS = 500;

/**
 * Subscribe to a context's live event stream. `onEvent` fires for every state
 * mutation in the given context — callers re-fetch their data on each
 * notification.
 *
 * The stream is the session's own `mero.events`: a node's SSE under its token
 * on a node login, and on an account the relay's caller-scoped stream under the
 * account's session. The `SseClient` this used to build itself — on the node
 * URL with the JWT read out of `localStorage["mero-tokens"]` — had neither on
 * a delegated session, so an account saw no live updates at all. The client is
 * shared with mero-react's own hooks, so it is never `close()`d here: handlers
 * come off and the context is unsubscribed, nothing more.
 */
export function useSse(
  contextId: string | null,
  onEvent: (payload: unknown) => void,
  onReconnect?: () => void,
) {
  const { mero } = useMero();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!contextId || !mero) return;
    const client = mero.events;

    // The `event` union keeps growing, and the additions are not context events:
    // mero-js 7 added group-membership, mero-js 13 added group-migration. Both
    // are keyed by `groupId` and carry no `contextId`. Only context events matter
    // here, so the runtime narrowing below is on the discriminating field and
    // survives the next addition — but the declared type still has to name every
    // member, because the union is not exported.
    const handler = (
      evt: SseEventData | GroupMembershipEventData | GroupMigrationEventData,
    ) => {
      if ("contextId" in evt && evt.contextId === contextId) {
        onEventRef.current(evt.data);
      }
    };

    // A stream that drops and comes back — the node was stopped and started
    // again, the laptop slept, the network blipped — reconnects and
    // re-subscribes on its own, but every event from while it was down is gone
    // for good, and so are the ones between the node coming back and this
    // client's next retry. Nothing replays them, so the page kept its
    // pre-outage state until it was re-mounted. Every `connect` after the first
    // is a reconnect: tell the page to re-read.
    //
    // Deferred so the re-subscribe that SseClient sends right after emitting
    // `connect` lands first — read before it, and a write in between is lost.
    let connectedOnce = false;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    const onConnect = () => {
      if (!connectedOnce) {
        connectedOnce = true;
        return;
      }
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        onReconnectRef.current?.();
      }, RESYNC_DELAY_MS);
    };
    const onError = (err: Error) => {
      console.warn("[MeroCalendar] SSE error (will reconnect):", err.message);
    };

    client.on("event", handler);
    client.on("connect", onConnect);
    client.on("error", onError);
    client.connect().catch(() => {});
    client.subscribe([contextId]).catch(() => {});

    return () => {
      if (resyncTimer) clearTimeout(resyncTimer);
      client.off("event", handler);
      client.off("connect", onConnect);
      client.off("error", onError);
      client.unsubscribe([contextId]).catch(() => {});
    };
  }, [contextId, mero]);
}
