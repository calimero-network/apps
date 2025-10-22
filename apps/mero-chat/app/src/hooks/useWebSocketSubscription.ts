import { useRef, useCallback, useEffect } from "react";
import type { CalimeroApp } from "@calimero-network/calimero-client";
import { log } from '../utils/logger';
import type { WebSocketEventCallback } from '../types/WebSocketTypes';

/**
 * Custom hook for managing WebSocket event subscriptions
 * Handles subscribing, unsubscribing, and cleanup
 */
export function useWebSocketSubscription(
  app: CalimeroApp | null | undefined,
  eventCallback: WebSocketEventCallback | null
) {
  const subscriptionContextIdRef = useRef<string>("");
  const eventCallbackRef = useRef(eventCallback);

  // Keep callback ref up to date
  useEffect(() => {
    eventCallbackRef.current = eventCallback;
  }, [eventCallback]);

  /**
   * Subscribe to events for a specific context
   */
  const subscribe = useCallback(
    (contextId: string) => {
      if (!app || !contextId || !eventCallbackRef.current) return;

      // Unsubscribe from previous context if different
      if (
        subscriptionContextIdRef.current &&
        subscriptionContextIdRef.current !== contextId
      ) {
        try {
          app.unsubscribeFromEvents([subscriptionContextIdRef.current]);
        } catch (error) {
          log.error(
            "WebSocket",
            `Failed to unsubscribe from: ${subscriptionContextIdRef.current}`,
            error
          );
        }
      }

      // Subscribe to new context
      try {
        app.subscribeToEvents([contextId], eventCallbackRef.current);
        subscriptionContextIdRef.current = contextId;
      } catch (error) {
        log.error("WebSocket", `Failed to subscribe to: ${contextId}`, error);
      }
    },
    [app]
  );

  /**
   * Unsubscribe from current context
   */
  const unsubscribe = useCallback(() => {
    if (app && subscriptionContextIdRef.current) {
      try {
        app.unsubscribeFromEvents([subscriptionContextIdRef.current]);
        subscriptionContextIdRef.current = "";
      } catch (error) {
        log.error("WebSocket", "Failed to unsubscribe", error);
      }
    }
  }, [app]);

  /**
   * Get current subscription context ID
   */
  const getCurrentContextId = useCallback(() => {
    return subscriptionContextIdRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (app && subscriptionContextIdRef.current) {
        try {
          app.unsubscribeFromEvents([subscriptionContextIdRef.current]);
        } catch (error) {
          log.error("WebSocket", "Failed to unsubscribe on unmount", error);
        }
      }
    };
  }, [app]);

  return {
    subscribe,
    unsubscribe,
    getCurrentContextId,
  };
}

