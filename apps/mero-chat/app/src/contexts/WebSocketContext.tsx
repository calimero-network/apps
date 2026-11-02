import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CloudEvent } from "@calimero-network/mero-js";

import { maybeConnection, onConnectionChange } from "../calimero/connection";
import type { WebSocketEvent } from "../types/WebSocketTypes";
import { log } from "../utils/logger";

/**
 * Live events of the open conversations, from mero-js's `client.events(app)`
 * (committed events, then live, over SSE). v1 subscribed one socket to every
 * context of the workspace; a 1.0 node streams one app per request, and a
 * browser holds at most six HTTP/1.1 connections to a node, so at most
 * `MAX_STREAMS` apps are streamed at once: the open conversation (and its
 * neighbours when asked). Everything else is caught up by polling the unread
 * counts (`Home`).
 *
 * Each event reaches listeners in v1's shape, `{ contextId, type:
 * "StateMutation", data: { events: [{ kind, data }] } }`, with the contract's
 * camelCase payload keys also given in snake_case (`messageId` and
 * `message_id`), so the screens read them as before.
 */
export const MAX_STREAMS = 3;

export type WebSocketEventListener = (event: WebSocketEvent) => void;

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

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** `{ messageId }` -> `{ messageId, message_id }`: both spellings. */
export function withSnakeKeys(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    out[snake(k)] = v;
  }
  return out;
}

export function toWebSocketEvent(app: string, kind: string, data: unknown): WebSocketEvent {
  return {
    contextId: app,
    type: "StateMutation",
    data: { events: [{ kind, data: withSnakeKeys(data) }] },
    timestamp: Date.now(),
  };
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [apps, setApps] = useState<string[]>([]);
  const appsRef = useRef<string[]>([]);
  appsRef.current = apps;
  const listenersRef = useRef<Set<WebSocketEventListener>>(new Set());
  const [generation, setGeneration] = useState(0);

  // A new session (or sign-out) restarts every stream.
  useEffect(() => onConnectionChange(() => setGeneration((g) => g + 1)), []);

  const emit = useCallback((event: WebSocketEvent) => {
    listenersRef.current.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        log.error("WebSocketContext", "Error in event listener", error);
      }
    });
  }, []);

  useEffect(() => {
    const conn = maybeConnection();
    if (!conn) return;
    const aborts = apps.slice(0, MAX_STREAMS).map((app) => {
      const abort = new AbortController();
      void (async () => {
        let from: number | null = null;
        let delay = 1_000;
        while (!abort.signal.aborted) {
          try {
            if (from === null) {
              // Start after what is committed now: earlier events are already
              // in what the screens read.
              const { index } = await conn.client.view(app, "getMessageCount", {});
              from = index + 1;
            }
            for await (const event of conn.client.events(app, from, abort.signal) as AsyncGenerator<CloudEvent>) {
              const at: number = Number(event.id);
              if (Number.isFinite(at)) from = at + 1;
              emit(toWebSocketEvent(app, event.kind, event.data));
              delay = 1_000;
            }
          } catch (e) {
            if (abort.signal.aborted) return;
            log.warn("WebSocketContext", `event stream for ${app} closed`, e);
          }
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 30_000);
        }
      })();
      return abort;
    });
    return () => aborts.forEach((a) => a.abort());
  }, [apps, emit, generation]);

  const subscribeToContexts = useCallback((ids: string[]) => {
    const next = [...new Set(ids.filter(Boolean))];
    setApps((prev) => (prev.join() === next.join() ? prev : next));
  }, []);
  const subscribeToContext = useCallback((id: string) => {
    if (!id) return;
    setApps((prev) => (prev.includes(id) ? prev : [id, ...prev]));
  }, []);
  const unsubscribeFromContext = useCallback((id: string) => {
    setApps((prev) => prev.filter((a) => a !== id));
  }, []);
  const unsubscribeAll = useCallback(() => setApps([]), []);

  const value = useMemo<WebSocketContextValue>(
    () => ({
      subscribeToContexts,
      subscribeToContext,
      unsubscribeFromContext,
      unsubscribeAll,
      getSubscribedContexts: () => appsRef.current.slice(0, MAX_STREAMS),
      isSubscribed: () => appsRef.current.length > 0,
      getSubscriptionCount: () => Math.min(appsRef.current.length, MAX_STREAMS),
      addEventListener: (l) => listenersRef.current.add(l),
      removeEventListener: (l) => listenersRef.current.delete(l),
    }),
    [subscribeToContexts, subscribeToContext, unsubscribeFromContext, unsubscribeAll],
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocket must be used within a WebSocketProvider");
  return ctx;
}

/** Calls `listener` for every event of the streamed conversations. */
export function useWebSocketEvents(listener: WebSocketEventListener): void {
  const ctx = useContext(WebSocketContext);
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    if (!ctx) return;
    const l: WebSocketEventListener = (e) => ref.current(e);
    ctx.addEventListener(l);
    return () => ctx.removeEventListener(l);
  }, [ctx]);
}
