import React, { createContext, useContext, useCallback, useRef, useEffect } from "react";
import { useCalimero, getContextId } from "@calimero-network/calimero-client";
import { useMultiWebSocketSubscription } from "../hooks/useMultiWebSocketSubscription";
import type { WebSocketEvent } from "../types/WebSocketTypes";
import { log } from "../utils/logger";

/**
 * WebSocket Context - Provides global access to WebSocket subscription state
 */

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

/**
 * WebSocket Provider - Manages global WebSocket subscriptions and event distribution
 */
export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const { app } = useCalimero();
  const eventListenersRef = useRef<Set<WebSocketEventListener>>(new Set());

  // Event callback that distributes to all registered listeners
  const eventCallbackFn = useCallback(async (event: WebSocketEvent) => {
    const mainContextId = getContextId();
    
    if (!mainContextId) {
      log.debug("WebSocketContext", "No context ID available, skipping event");
      return;
    }

    // Notify all registered listeners
    eventListenersRef.current.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        log.error("WebSocketContext", "Error in event listener", error);
      }
    });
  }, []);

  // Initialize multi-context subscription
  const subscription = useMultiWebSocketSubscription(app, eventCallbackFn);

  // Add event listener
  const addEventListener = useCallback((listener: WebSocketEventListener) => {
    eventListenersRef.current.add(listener);
    log.debug("WebSocketContext", `Event listener added. Total: ${eventListenersRef.current.size}`);
  }, []);

  // Remove event listener
  const removeEventListener = useCallback((listener: WebSocketEventListener) => {
    eventListenersRef.current.delete(listener);
    log.debug("WebSocketContext", `Event listener removed. Total: ${eventListenersRef.current.size}`);
  }, []);

  const contextValue: WebSocketContextValue = {
    subscribeToContexts: subscription.subscribeToContexts,
    subscribeToContext: subscription.subscribeToContext,
    unsubscribeFromContext: subscription.unsubscribeFromContext,
    unsubscribeAll: subscription.unsubscribeAll,
    getSubscribedContexts: subscription.getSubscribedContexts,
    isSubscribed: subscription.isSubscribed,
    getSubscriptionCount: subscription.getSubscriptionCount,
    addEventListener,
    removeEventListener,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

/**
 * Hook to access WebSocket subscription from any component
 */
export function useWebSocket() {
  const context = useContext(WebSocketContext);
  
  if (!context) {
    throw new Error("useWebSocket must be used within WebSocketProvider");
  }
  
  return context;
}

/**
 * Hook to listen to WebSocket events from any component
 * Automatically handles cleanup on unmount
 */
export function useWebSocketEvents(listener: WebSocketEventListener) {
  const { addEventListener, removeEventListener } = useWebSocket();
  const listenerRef = useRef(listener);

  // Keep listener ref updated
  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    const wrappedListener = (event: WebSocketEvent) => {
      listenerRef.current(event);
    };

    addEventListener(wrappedListener);

    return () => {
      removeEventListener(wrappedListener);
    };
  }, [addEventListener, removeEventListener]);
}

