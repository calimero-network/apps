import { useRef, useCallback, useEffect } from "react";
import type { CalimeroApp } from "@calimero-network/calimero-client";
import { log } from "../utils/logger";
import type { WebSocketEventCallback } from "../types/WebSocketTypes";

/**
 * Custom hook for managing multiple WebSocket event subscriptions
 * Allows subscribing to multiple contexts simultaneously for real-time updates across all channels
 */
export function useMultiWebSocketSubscription(
  app: CalimeroApp | null | undefined,
  eventCallback: WebSocketEventCallback | null,
) {
  const subscribedContextsRef = useRef<Set<string>>(new Set());
  const eventCallbackRef = useRef(eventCallback);

  // Keep callback ref up to date WITHOUT re-subscribing
  useEffect(() => {
    eventCallbackRef.current = eventCallback;
  }, [eventCallback]);

  /**
   * Subscribe to multiple contexts
   */
  const subscribeToContexts = useCallback(
    (contextIds: string[]) => {
      if (!app || !eventCallbackRef.current) {
        log.debug("MultiWebSocket", "Subscribe called but conditions not met", {
          hasApp: !!app,
          hasCallback: !!eventCallbackRef.current,
        });
        return;
      }

      const validContextIds = contextIds.filter((id) => id && id.trim());
      if (validContextIds.length === 0) {
        log.debug("MultiWebSocket", "No valid context IDs provided");
        return;
      }

      // Find new contexts to subscribe to
      const currentSubscriptions = subscribedContextsRef.current;
      const newContexts = validContextIds.filter(
        (id) => !currentSubscriptions.has(id),
      );

      // Find contexts to unsubscribe from (no longer in the list)
      const contextsToRemove = Array.from(currentSubscriptions).filter(
        (id) => !validContextIds.includes(id),
      );

      // Unsubscribe from removed contexts
      if (contextsToRemove.length > 0) {
        try {
          log.info(
            "MultiWebSocket",
            `Unsubscribing from ${contextsToRemove.length} contexts`,
            contextsToRemove,
          );
          app.unsubscribeFromEvents(contextsToRemove);
          contextsToRemove.forEach((id) => currentSubscriptions.delete(id));
        } catch (error) {
          log.error(
            "MultiWebSocket",
            "Failed to unsubscribe from contexts",
            error,
          );
        }
      }

      // Subscribe to new contexts
      if (newContexts.length > 0) {
        try {
          log.info(
            "MultiWebSocket",
            `Subscribing to ${newContexts.length} new contexts`,
            newContexts,
          );
          app.subscribeToEvents(newContexts, eventCallbackRef.current);
          newContexts.forEach((id) => currentSubscriptions.add(id));
        } catch (error) {
          log.error("MultiWebSocket", "Failed to subscribe to contexts", error);
        }
      }

      log.debug(
        "MultiWebSocket",
        `Currently subscribed to ${currentSubscriptions.size} contexts`,
      );
    },
    [app],
  );

  /**
   * Subscribe to a single additional context
   */
  const subscribeToContext = useCallback(
    (contextId: string) => {
      if (!app || !contextId || !eventCallbackRef.current) {
        return;
      }

      if (subscribedContextsRef.current.has(contextId)) {
        log.debug(
          "MultiWebSocket",
          `Already subscribed to context: ${contextId}`,
        );
        return;
      }

      try {
        log.info("MultiWebSocket", `Subscribing to context: ${contextId}`);
        app.subscribeToEvents([contextId], eventCallbackRef.current);
        subscribedContextsRef.current.add(contextId);
      } catch (error) {
        log.error(
          "MultiWebSocket",
          `Failed to subscribe to: ${contextId}`,
          error,
        );
      }
    },
    [app],
  );

  /**
   * Unsubscribe from a specific context
   */
  const unsubscribeFromContext = useCallback(
    (contextId: string) => {
      if (!app || !contextId) {
        return;
      }

      if (!subscribedContextsRef.current.has(contextId)) {
        log.debug("MultiWebSocket", `Not subscribed to context: ${contextId}`);
        return;
      }

      try {
        log.info("MultiWebSocket", `Unsubscribing from context: ${contextId}`);
        app.unsubscribeFromEvents([contextId]);
        subscribedContextsRef.current.delete(contextId);
      } catch (error) {
        log.error(
          "MultiWebSocket",
          `Failed to unsubscribe from: ${contextId}`,
          error,
        );
      }
    },
    [app],
  );

  /**
   * Unsubscribe from all contexts
   */
  const unsubscribeAll = useCallback(() => {
    if (!app) return;

    const contexts = Array.from(subscribedContextsRef.current);
    if (contexts.length === 0) return;

    try {
      log.info("MultiWebSocket", `Unsubscribing from all ${contexts.length} contexts`);
      app.unsubscribeFromEvents(contexts);
      subscribedContextsRef.current.clear();
    } catch (error) {
      log.error("MultiWebSocket", "Failed to unsubscribe from all", error);
    }
  }, [app]);

  /**
   * Get list of currently subscribed contexts
   */
  const getSubscribedContexts = useCallback(() => {
    return Array.from(subscribedContextsRef.current);
  }, []);

  /**
   * Check if subscribed to any contexts
   */
  const isSubscribed = useCallback(() => {
    return subscribedContextsRef.current.size > 0;
  }, []);

  /**
   * Get count of subscribed contexts
   */
  const getSubscriptionCount = useCallback(() => {
    return subscribedContextsRef.current.size;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const contexts = Array.from(subscribedContextsRef.current);
      if (app && contexts.length > 0) {
        try {
          log.info(
            "MultiWebSocket",
            `Cleanup: Unsubscribing from ${contexts.length} contexts`,
          );
          app.unsubscribeFromEvents(contexts);
          subscribedContextsRef.current.clear();
        } catch (error) {
          log.error("MultiWebSocket", "Failed to unsubscribe on unmount", error);
        }
      }
    };
  }, [app]);

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

