import { useEffect, useRef } from "react";
import { SseClient, type SseEventData } from "@calimero-network/mero-js";
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

    const handler = (evt: SseEventData) => {
      if (evt.contextId === contextId) {
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
