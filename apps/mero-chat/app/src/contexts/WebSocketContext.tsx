import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WebSocketEvent } from "../types/WebSocketTypes";
import { useAppEvents, type AppEvent } from "../api/events";
import { log } from "../utils/logger";

interface WebSocketContextValue {
  subscribeToContexts: (contextIds: string[]) => void;
  subscribeToContext: (contextId: string) => void;
  subscribeToGroup: (groupId: string) => void;
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

  const eventCallbackFn = useCallback((event: AppEvent) => {
    // One event of one app instance, in v1's StateMutation shape: the hooks
    // that refresh on `MessageSent`, `ReactionUpdated`, ... read it unchanged.
    const wsEvent: WebSocketEvent = {
      contextId: event.app,
      type: "StateMutation",
      data: { events: [{ kind: event.kind, data: event.data }] },
    };

    log.info("WebSocketContext", `[SSE] ${event.kind} received contextId=${event.app}`);

    eventListenersRef.current.forEach((listener) => {
      try {
        listener(wsEvent);
      } catch (error) {
        log.error("WebSocketContext", "Error in event listener", error);
      }
    });
  }, []);

  useAppEvents(subscribedContextIds, eventCallbackFn);

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

  // v1 streamed namespace membership changes; an org has no event stream on
  // Calimero 1.0, so member lists refresh when they are opened instead.
  const subscribeToGroup = useCallback((_groupId: string) => {}, []);

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
      subscribeToGroup,
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
      subscribeToGroup,
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
