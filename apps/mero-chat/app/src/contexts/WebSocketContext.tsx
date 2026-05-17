import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSubscription } from "@calimero-network/mero-react";
import type { SseEventData } from "@calimero-network/mero-react";
import type { WebSocketEvent, StateMutationData } from "../types/WebSocketTypes";
import { log } from "../utils/logger";

interface WebSocketContextValue {
  subscribeToContexts: (contextIds: string[]) => void;
  subscribeToContext: (contextId: string) => void;
  unsubscribeFromContext: (contextId: string) => void;
  unsubscribeAll: () => void;
  getSubscribedContexts: () => string[];
  isSubscribed: () => boolean;
  getSubscriptionCount: () => number;
  addEventListener: (listener: WebSocketEventListener) => void;
  removeEventListener: (listener: WebSocketEventListener) => void;
}

export type WebSocketEventListener = (event: WebSocketEvent) => void;

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [subscribedContextIds, setSubscribedContextIds] = useState<string[]>([]);
  const subscribedContextIdsRef = useRef<string[]>([]);
  subscribedContextIdsRef.current = subscribedContextIds;

  const eventListenersRef = useRef<Set<WebSocketEventListener>>(new Set());

  const eventCallbackFn = useCallback((event: SseEventData) => {
    log.info("WebSocketContext", `[SSE] event received contextId=${event.contextId}`, event.data);
    const wsEvent: WebSocketEvent = {
      contextId: event.contextId,
      type: "StateMutation",
      data: event.data as StateMutationData,
    };
    eventListenersRef.current.forEach((listener) => {
      try {
        listener(wsEvent);
      } catch (error) {
        log.error("WebSocketContext", "Error in event listener", error);
      }
    });
  }, []);

  useSubscription(subscribedContextIds, eventCallbackFn);

  const subscribeToContexts = useCallback((contextIds: string[]) => {
    const valid = contextIds.filter(Boolean);
    setSubscribedContextIds(valid);
    log.info("WebSocketContext", `Subscribing to ${valid.length} contexts`);
  }, []);

  const subscribeToContext = useCallback((contextId: string) => {
    if (!contextId) return;
    setSubscribedContextIds((prev) =>
      prev.includes(contextId) ? prev : [...prev, contextId],
    );
  }, []);

  const unsubscribeFromContext = useCallback((contextId: string) => {
    setSubscribedContextIds((prev) => prev.filter((id) => id !== contextId));
  }, []);

  const unsubscribeAll = useCallback(() => {
    setSubscribedContextIds([]);
  }, []);

  // Read from ref so these are stable functions that always return current values
  const getSubscribedContexts = useCallback(
    () => subscribedContextIdsRef.current,
    [],
  );
  const isSubscribed = useCallback(
    () => subscribedContextIdsRef.current.length > 0,
    [],
  );
  const getSubscriptionCount = useCallback(
    () => subscribedContextIdsRef.current.length,
    [],
  );

  const addEventListener = useCallback((listener: WebSocketEventListener) => {
    eventListenersRef.current.add(listener);
    log.debug(
      "WebSocketContext",
      `Event listener added. Total: ${eventListenersRef.current.size}`,
    );
  }, []);

  const removeEventListener = useCallback(
    (listener: WebSocketEventListener) => {
      eventListenersRef.current.delete(listener);
      log.debug(
        "WebSocketContext",
        `Event listener removed. Total: ${eventListenersRef.current.size}`,
      );
    },
    [],
  );

  const contextValue = useMemo<WebSocketContextValue>(
    () => ({
      subscribeToContexts,
      subscribeToContext,
      unsubscribeFromContext,
      unsubscribeAll,
      getSubscribedContexts,
      isSubscribed,
      getSubscriptionCount,
      addEventListener,
      removeEventListener,
    }),
    [
      subscribeToContexts,
      subscribeToContext,
      unsubscribeFromContext,
      unsubscribeAll,
      getSubscribedContexts,
      isSubscribed,
      getSubscriptionCount,
      addEventListener,
      removeEventListener,
    ],
  );

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);

  if (!context) {
    throw new Error("useWebSocket must be used within WebSocketProvider");
  }

  return context;
}

/**
 * Hook to listen to WebSocket events from any component.
 * Automatically handles cleanup on unmount.
 */
export function useWebSocketEvents(listener: WebSocketEventListener) {
  const { addEventListener, removeEventListener } = useWebSocket();
  const listenerRef = useRef(listener);

  listenerRef.current = listener;

  React.useEffect(() => {
    const wrappedListener = (event: WebSocketEvent) => {
      listenerRef.current(event);
    };

    addEventListener(wrappedListener);

    return () => {
      removeEventListener(wrappedListener);
    };
  }, [addEventListener, removeEventListener]);
}
