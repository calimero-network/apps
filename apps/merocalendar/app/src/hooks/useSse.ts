import { useEffect, useRef } from "react";
import {
  SseClient,
  type GroupMembershipEventData,
  type SseEventData,
} from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";
import { getJwt } from "../api/rpc";

/**
 * Subscribe to a context's live event stream over SSE (rc.8 replacement for the
 * legacy `WsSubscriptionsClient`). `onEvent` fires for every state mutation in
 * the given context — callers re-fetch their data on each notification.
 */
export function useSse(
  contextId: string | null,
  onEvent: (payload: unknown) => void,
) {
  const { nodeUrl } = useMero();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!contextId || !nodeUrl) return;

    // reconnectDelayMs=8000: slower reconnects reduce wallet MaxListeners noise.
    const client = new SseClient({
      baseUrl: nodeUrl,
      getAuthToken: async () => getJwt(),
      reconnectDelayMs: 8000,
    });

    // mero-js 7 widened this handler: an `event` can also be a group-membership
    // event, which is keyed by `groupId` and carries no `contextId`. Only
    // context events matter here, so narrow on the discriminating field.
    const handler = (evt: SseEventData | GroupMembershipEventData) => {
      if ("contextId" in evt && evt.contextId === contextId) {
        onEventRef.current(evt.data);
      }
    };

    client.on("event", handler);
    client.on("error", (err: Error) => {
      console.warn("[MeroCalendar] SSE error (will reconnect):", err.message);
    });
    client.connect().catch(() => {});
    client.subscribe([contextId]).catch(() => {});

    return () => {
      client.off("event", handler);
      client.close();
    };
  }, [contextId, nodeUrl]);
}
