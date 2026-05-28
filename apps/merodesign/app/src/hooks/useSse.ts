import { useEffect, useRef } from "react";
import { useAuthStore } from "../store/authStore";

export function useSse(
  contextId: string | null,
  onEvent: (event: MessageEvent) => void,
) {
  const { nodeUrl, accessToken } = useAuthStore();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!contextId || !nodeUrl || !accessToken) return;

    const url = `${nodeUrl}/admin-api/contexts/${contextId}/events?token=${encodeURIComponent(accessToken)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = onEvent;
    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [contextId, nodeUrl, accessToken, onEvent]);
}
