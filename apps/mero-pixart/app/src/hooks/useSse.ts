import { useEffect, useRef } from "react";
import {
  SseClient,
  type GroupMembershipEventData,
  type GroupMigrationEventData,
  type SseEventData,
} from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";
import { getJwt } from "../api/rpc";

/** How long after a reconnect to wait before re-reading state. */
const RESYNC_DELAY_MS = 500;

export function useSse(
  contextId: string | null,
  onEvent: (payload: unknown) => void,
  onReconnect?: () => void,
) {
  const { nodeUrl } = useMero();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!contextId || !nodeUrl) return;

    // reconnectDelayMs=8000: slower reconnects reduce wallet MaxListeners noise.
    const client = new SseClient({
      baseUrl: nodeUrl,
      getAuthToken: async () => getJwt(),
      reconnectDelayMs: 8000,
    });

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
    // client's next retry (up to `reconnectDelayMs` later). Nothing replays
    // them, so the page kept its pre-outage state until it was re-mounted.
    // Every `connect` after the first is a reconnect: tell the page to re-read.
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

    client.on("event", handler);
    client.on("connect", onConnect);
    client.on("error", (err: Error) => {
      console.warn("[MeroPixArt] SSE error (will reconnect):", err.message);
    });
    client.connect().catch(() => {});
    client.subscribe([contextId]).catch(() => {});

    return () => {
      if (resyncTimer) clearTimeout(resyncTimer);
      client.off("event", handler);
      client.off("connect", onConnect);
      client.close();
    };
  }, [contextId, nodeUrl]);
}
