import { useEffect, useRef } from "react";
import type {
  GroupMembershipEventData,
  GroupMigrationEventData,
  SseClient,
  SseEventData,
} from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";

/** How long after a (re)connect to wait before re-reading state. */
const RESYNC_DELAY_MS = 500;

/**
 * The session's event stream, or null when this session cannot observe one.
 *
 * `mero.events` is the one stream for both transports: the node's `/sse` on a
 * node login, the relay's — minted with the account's proof — on a delegated
 * session. A relay client that has not yet learned the relay's node key throws
 * from the getter (`canSubscribe` says so first), and a hook reading a raw JWT
 * out of localStorage, as this one used to, had nothing to send on a delegated
 * session at all.
 */
function eventsOf(mero: ReturnType<typeof useMero>["mero"]): SseClient | null {
  if (!mero) return null;
  if ("canSubscribe" in mero && !mero.canSubscribe) return null;
  try {
    return mero.events;
  } catch {
    return null;
  }
}

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
    if (!contextId) return;
    const client = eventsOf(mero);
    if (!client) return;

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
    // client's next retry. Nothing replays them, so the page kept its
    // pre-outage state until it was re-mounted. Every `connect` tells the page
    // to re-read.
    //
    // The client is SHARED with the provider (which keeps it connected for its
    // own liveness probe), so this hook cannot tell a first connect from a
    // reconnect: the stream may already be up when the editor mounts. A re-read
    // on the initial connect costs one debounced refetch of state the page has
    // just loaded, which is cheaper than missing the reconnect that matters.
    //
    // Deferred so the re-subscribe that SseClient sends right after emitting
    // `connect` lands first — read before it, and a write in between is lost.
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    const onConnect = () => {
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        onReconnectRef.current?.();
      }, RESYNC_DELAY_MS);
    };
    const onError = (err: Error) => {
      console.warn("[MeroPixArt] SSE error (will reconnect):", err.message);
    };

    client.on("event", handler);
    client.on("connect", onConnect);
    client.on("error", onError);
    client.connect().catch(() => {});
    client.subscribe([contextId]).catch(() => {});

    // Shared client: unsubscribe this context and drop our listeners, never
    // `close()` — the provider's probe and any other page are still on it.
    return () => {
      if (resyncTimer) clearTimeout(resyncTimer);
      client.off("event", handler);
      client.off("connect", onConnect);
      client.off("error", onError);
      client.unsubscribe([contextId]).catch(() => {});
    };
  }, [contextId, mero]);
}
