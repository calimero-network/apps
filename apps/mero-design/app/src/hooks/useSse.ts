import { useEffect, useRef } from "react";
import type {
  GroupMembershipEventData,
  GroupMigrationEventData,
  SseClient,
  SseEventData,
} from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";

/** How long after a reconnect to wait before re-reading state. */
const RESYNC_DELAY_MS = 500;

/**
 * Whether the shared stream already has a session when this hook mounts.
 *
 * mero-js keeps the session id private; peeking is best-effort and a client
 * that does not expose it reads as "not connected", which is the safe answer
 * (the first connect is then treated as the initial one, as before).
 */
function hasSession(client: SseClient): boolean {
  const id = (client as unknown as { sessionId?: unknown }).sessionId;
  return typeof id === "string" && id.length > 0;
}

/**
 * Live events for one board, from the SESSION's event stream.
 *
 * The stream is `mero.events` — the node's SSE on a node login, the relay's
 * caller-scoped stream on an account session — so one hook serves both. It is
 * shared with the rest of the client, so this hook subscribes and unsubscribes
 * its context but never closes the stream.
 */
export function useSse(
  contextId: string | null,
  onEvent: (payload: unknown) => void,
  onReconnect?: () => void,
) {
  const { mero } = useMero();
  let client: SseClient | null = null;
  try {
    client = mero?.events ?? null;
  } catch {
    // A transport with no stream (an account with no relay yet): no live events.
    client = null;
  }
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!contextId || !client) return;

    // mero-js 7 widened this handler: an `event` can also be a group-membership
    // event, which is keyed by `groupId` and carries no `contextId`. This hook
    // only forwards context events, so narrow on the discriminating field.
    const handler = (evt: SseEventData | GroupMembershipEventData | GroupMigrationEventData) => {
      if ("contextId" in evt && evt.contextId === contextId) {
        onEventRef.current(evt.data);
      }
    };

    // A stream that drops and comes back — the node was stopped and started
    // again, the laptop slept, the network blipped — reconnects and
    // re-subscribes on its own, but every event from while it was down is gone
    // for good, and so are the ones between the node coming back and this
    // client's next retry (up to the client's reconnect delay later). Nothing
    // replays them, so the page kept its pre-outage state until it was
    // re-mounted. Every `connect` after the first is a reconnect: tell the page
    // to re-read. When the shared stream was already open before this board
    // mounted, there is no "first" to skip — every connect it sees is a
    // reconnect.
    //
    // Deferred so the re-subscribe that SseClient sends right after emitting
    // `connect` lands first — read before it, and a write in between is lost.
    let connectedOnce = hasSession(client);
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
      console.warn("[MeroDesign] SSE error (will reconnect):", err.message);
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
  }, [contextId, client]);
}
