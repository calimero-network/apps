import { useRef, useCallback, useEffect } from "react";
import { SseClient } from "@calimero-network/mero-js";
import { getNodeUrl } from "@calimero-network/mero-react";
import { getJwt } from "../api/meroJsClient";
import type { WebSocketEvent, WebSocketEventCallback } from "../types/WebSocketTypes";
import { log } from "../utils/logger";

// SseClient expects an async `getAuthToken`. Wrap our sync localStorage
// reader to satisfy the contract.
async function getAuthToken(): Promise<string> {
  return getJwt();
}

/**
 * SSE-based context subscription hook.
 *
 * Replaces useMultiWebSocketSubscription which used app.subscribeToEvents()
 * (ExperimentalWebSocket). That had two fatal bugs:
 *   1. Subscribe messages dropped if WS not OPEN at call time
 *   2. No re-subscription after reconnect
 *
 * SseSubscriptionsClient fixes both: subscribe() is an HTTP POST (never
 * dropped), and the node server maintains session subscriptions across
 * reconnects automatically.
 */
export function useSseSubscription(eventCallback: WebSocketEventCallback | null) {
  const clientRef = useRef<SseClient | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const callbackRef = useRef(eventCallback);
  const connectingRef = useRef(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    callbackRef.current = eventCallback;
  }, [eventCallback]);

  const getOrCreate = useCallback((): SseClient | null => {
    if (clientRef.current) return clientRef.current;
    const nodeUrl = getNodeUrl();
    if (!nodeUrl) {
      log.warn("SseSubscription", "No node URL in storage — cannot create SSE client");
      return null;
    }
    const client = new SseClient({ baseUrl: nodeUrl, getAuthToken });
    client.on("event", (event) => {
      if (callbackRef.current) {
        callbackRef.current(event as unknown as WebSocketEvent).catch(() => {});
      }
    });
    clientRef.current = client;
    log.info("SseSubscription", `SSE client created for ${nodeUrl}`);
    return client;
  }, []);

  const ensureConnected = useCallback(async (): Promise<SseClient | null> => {
    const client = getOrCreate();
    if (!client) return null;
    if (connectedRef.current || connectingRef.current) return client;
    connectingRef.current = true;
    try {
      await client.connect();
      connectedRef.current = true;
      log.info("SseSubscription", "SSE connected");
    } catch (err) {
      log.error("SseSubscription", "SSE connect failed", err);
      // Non-fatal: subscribe() will retry internally when session arrives
    } finally {
      connectingRef.current = false;
    }
    return client;
  }, [getOrCreate]);

  const subscribeToContexts = useCallback(
    (contextIds: string[]) => {
      const valid = contextIds.filter(Boolean);

      void (async () => {
        // If the new list is empty we still need to unsubscribe any existing contexts
        if (!valid.length && !subscribedRef.current.size) return;

        const client = await ensureConnected();
        if (!client) return;

        const current = subscribedRef.current;

        // Unsubscribe contexts that dropped out of the list
        const toRemove = [...current].filter((id) => !valid.includes(id));
        if (toRemove.length) {
          try {
            await client.unsubscribe(toRemove);
            toRemove.forEach((id) => current.delete(id));
            log.debug("SseSubscription", `Unsubscribed ${toRemove.length} contexts`);
          } catch (e) {
            log.warn("SseSubscription", "Unsubscribe failed (non-fatal)", e);
          }
        }

        // Subscribe only new contexts
        const toAdd = valid.filter((id) => !current.has(id));
        if (!toAdd.length) return;

        try {
          await client.subscribe(toAdd);
          toAdd.forEach((id) => current.add(id));
          log.info("SseSubscription", `Subscribed to ${toAdd.length} new contexts`, toAdd);
        } catch (e) {
          log.error("SseSubscription", "Subscribe failed", e);
        }
      })();
    },
    [ensureConnected],
  );

  const subscribeToContext = useCallback(
    (contextId: string) => {
      if (!contextId || subscribedRef.current.has(contextId)) return;
      void (async () => {
        const client = await ensureConnected();
        if (!client) return;
        try {
          await client.subscribe([contextId]);
          subscribedRef.current.add(contextId);
          log.debug("SseSubscription", `Subscribed to ${contextId}`);
        } catch (e) {
          log.error("SseSubscription", `Failed to subscribe to ${contextId}`, e);
        }
      })();
    },
    [ensureConnected],
  );

  const unsubscribeFromContext = useCallback(
    (contextId: string) => {
      if (!contextId || !subscribedRef.current.has(contextId)) return;
      const client = clientRef.current;
      if (!client) return;
      void client.unsubscribe([contextId]).then(() => {
        subscribedRef.current.delete(contextId);
        log.debug("SseSubscription", `Unsubscribed from ${contextId}`);
      }).catch(() => {});
    },
    [],
  );

  const unsubscribeAll = useCallback(() => {
    const client = clientRef.current;
    if (!client || !subscribedRef.current.size) return;
    const all = [...subscribedRef.current];
    void client.unsubscribe(all).then(() => {
      subscribedRef.current.clear();
      log.debug("SseSubscription", "Unsubscribed from all contexts");
    }).catch(() => {});
  }, []);

  const getSubscribedContexts = useCallback(
    () => [...subscribedRef.current],
    [],
  );

  const isSubscribed = useCallback(
    () => subscribedRef.current.size > 0,
    [],
  );

  const getSubscriptionCount = useCallback(
    () => subscribedRef.current.size,
    [],
  );

  // Disconnect and clean up on unmount / logout
  useEffect(() => {
    return () => {
      const client = clientRef.current;
      if (client) {
        try { client.close(); } catch { /* ignore */ }
        clientRef.current = null;
        connectedRef.current = false;
        connectingRef.current = false;
        subscribedRef.current.clear();
        log.debug("SseSubscription", "Disconnected on unmount");
      }
    };
  }, []);

  return {
    subscribeToContexts,
    subscribeToContext,
    unsubscribeFromContext,
    unsubscribeAll,
    getSubscribedContexts,
    isSubscribed,
    getSubscriptionCount,
  };
}
