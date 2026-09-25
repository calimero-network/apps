import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSubscription } from "@calimero-network/mero-react";
import type {
  GroupMembershipEventData,
  GroupMigrationEventData,
  SubscriptionEventData,
} from "@calimero-network/mero-react";
import type {
  WebSocketEvent,
  StateMutationData,
} from "../types/WebSocketTypes";
import { log } from "../utils/logger";

// Both group-keyed families carry `groupId`, so presence of that field alone
// no longer separates them: mero-react 6 widened SubscriptionEventData to
// include GroupMigrationEventData. Narrow on the type tag instead, or a
// migration event would be handled as a membership change.
const MEMBERSHIP_KINDS = ["MemberJoined", "MemberAdded", "MemberRemoved"] as const;
const MIGRATION_KINDS = [
  "MigrationStarted",
  "MigrationProgress",
  "CascadeProgress",
  "MigrationCompleted",
] as const;

function isGroupMembershipEvent(
  event: SubscriptionEventData,
): event is GroupMembershipEventData {
  const e = event as GroupMembershipEventData;
  return (
    typeof e.groupId === "string" &&
    (MEMBERSHIP_KINDS as readonly string[]).includes(e.type)
  );
}

function isGroupMigrationEvent(
  event: SubscriptionEventData,
): event is GroupMigrationEventData {
  const e = event as GroupMigrationEventData;
  return (
    typeof e.groupId === "string" &&
    (MIGRATION_KINDS as readonly string[]).includes(e.type)
  );
}

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

  const [subscribedGroupIds, setSubscribedGroupIds] = useState<string[]>([]);

  const eventListenersRef = useRef<Set<WebSocketEventListener>>(new Set());

  const eventCallbackFn = useCallback((event: SubscriptionEventData) => {
    // Group-membership events are a separate id-space: keyed by `groupId`,
    // no `contextId`, no `data.events`. Coercing everything to
    // "StateMutation" (as this did) made them indistinguishable from a
    // context event with no execution events, so every listener dropped them.
    // Migration events are group-keyed too but carry none of the membership or
    // state-mutation payload. Coercing them into StateMutation is the same bug
    // the membership branch above exists to fix, so drop them explicitly until
    // a consumer needs them.
    if (isGroupMigrationEvent(event)) {
      log.info(
        "WebSocketContext",
        `[SSE] ignoring migration event ${event.type} on groupId=${event.groupId}`,
      );
      return;
    }

    const wsEvent: WebSocketEvent = isGroupMembershipEvent(event)
      ? {
          contextId: "",
          type: "GroupMembership",
          groupId: event.groupId,
          membershipKind: event.type,
          membership: event.data,
        }
      : {
          contextId: event.contextId,
          type: "StateMutation",
          data: event.data as StateMutationData,
        };

    log.info(
      "WebSocketContext",
      `[SSE] ${wsEvent.type} received ${wsEvent.groupId ? `groupId=${wsEvent.groupId}` : `contextId=${wsEvent.contextId}`}`,
      wsEvent.membership ?? wsEvent.data,
    );

    eventListenersRef.current.forEach((listener) => {
      try {
        listener(wsEvent);
      } catch (error) {
        log.error("WebSocketContext", "Error in event listener", error);
      }
    });
  }, []);

  // Object form so group ids ride along; core routes the two id-spaces
  // independently and drops a membership event unless its group is subscribed.
  const subscriptionInput = useMemo(
    () => ({ contextIds: subscribedContextIds, groupIds: subscribedGroupIds }),
    [subscribedContextIds, subscribedGroupIds],
  );
  useSubscription(subscriptionInput, eventCallbackFn);

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

  const subscribeToGroup = useCallback((groupId: string) => {
    if (!groupId) return;
    setSubscribedGroupIds((prev) =>
      prev.includes(groupId) ? prev : [...prev, groupId],
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
