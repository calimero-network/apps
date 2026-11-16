import { useState, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

/**
 * The read marker is a contract write, and every message that lands in the
 * open chat used to write it again: one mutation per received message per
 * reader. It is now written at most once per READ_MARKER_INTERVAL_MS per
 * context. The first call writes at once (opening a chat clears its unread
 * count on the node right away); calls inside the window fold into one
 * trailing write with the latest time, and a pending write goes out when the
 * tab is hidden so a closed tab does not leave the marker behind.
 */
export const READ_MARKER_INTERVAL_MS = 10_000;

interface MarkerState {
  lastWriteAt: number;
  pending: { contextIdentity: string; timestamp: number } | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const markers = new Map<string, MarkerState>();

function writeMarker(contextId: string, contextIdentity: string, timestamp: number) {
  new ClientApiDataSource()
    .markAsRead({ contextId, executorPublicKey: contextIdentity, timestamp })
    // Silently fails if the context isn't joined yet.
    .catch(() => {});
}

function flushMarker(contextId: string) {
  const state = markers.get(contextId);
  if (!state?.pending) return;
  if (state.timer) clearTimeout(state.timer);
  const { contextIdentity, timestamp } = state.pending;
  state.pending = null;
  state.timer = null;
  state.lastWriteAt = Date.now();
  writeMarker(contextId, contextIdentity, timestamp);
}

export function markRead(contextId: string, contextIdentity: string, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  const state = markers.get(contextId) ?? { lastWriteAt: 0, pending: null, timer: null };
  markers.set(contextId, state);
  const wait = state.lastWriteAt + READ_MARKER_INTERVAL_MS - now;
  if (wait <= 0 && !state.timer) {
    state.lastWriteAt = now;
    writeMarker(contextId, contextIdentity, timestamp);
    return;
  }
  state.pending = { contextIdentity, timestamp };
  if (!state.timer) {
    state.timer = setTimeout(() => flushMarker(contextId), Math.max(wait, 0));
  }
}

/** Test hook: forget every marker's timing. */
export function resetReadMarkers() {
  for (const state of markers.values()) if (state.timer) clearTimeout(state.timer);
  markers.clear();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      for (const contextId of markers.keys()) flushMarker(contextId);
    }
  });
}

export interface ContextUnread {
  messages: number;
  mentions: number;
}

export interface ContextForUnread {
  contextId: string;
  contextIdentity?: string;
}

export function useUnreadCounts() {
  const [counts, setCounts] = useState<Map<string, ContextUnread>>(new Map());

  const loadAll = useCallback(async (contexts: ContextForUnread[]) => {
    const valid = contexts.filter((c) => Boolean(c.contextId));
    if (valid.length === 0) return;

    const api = new ClientApiDataSource();
    const results = await Promise.allSettled(
      valid.map(async ({ contextId, contextIdentity }) => {
        const [msgRes, mentionRes] = await Promise.all([
          api.getUnreadCount({ contextId, executorPublicKey: contextIdentity ?? "" }),
          api.getUnreadMentions({ contextId, executorPublicKey: contextIdentity ?? "" }),
        ]);
        return {
          contextId,
          messages: msgRes.data ?? 0,
          mentions: mentionRes.data ?? 0,
        };
      }),
    );

    setCounts((prev) => {
      const next = new Map(prev);
      for (const result of results) {
        if (result.status === "fulfilled") {
          const { contextId, messages, mentions } = result.value;
          next.set(contextId, { messages, mentions });
        }
      }
      return next;
    });
  }, []);

  const refreshOne = useCallback(
    async (contextId: string, contextIdentity: string) => {
      if (!contextId || !contextIdentity) return;
      const api = new ClientApiDataSource();
      const [msgRes, mentionRes] = await Promise.all([
        api.getUnreadCount({ contextId, executorPublicKey: contextIdentity }),
        api.getUnreadMentions({ contextId, executorPublicKey: contextIdentity }),
      ]);
      setCounts((prev) => {
        const next = new Map(prev);
        next.set(contextId, {
          messages: msgRes.data ?? 0,
          mentions: mentionRes.data ?? 0,
        });
        return next;
      });
    },
    [],
  );

  const clearOne = useCallback(
    async (contextId: string, contextIdentity: string) => {
      if (!contextId || !contextIdentity) return;
      // Optimistic clear so the badge disappears instantly on click.
      setCounts((prev) => {
        const next = new Map(prev);
        next.set(contextId, { messages: 0, mentions: 0 });
        return next;
      });
      // Persist to the node, at most once per READ_MARKER_INTERVAL_MS.
      markRead(contextId, contextIdentity);
    },
    [],
  );

  return { counts, loadAll, refreshOne, clearOne };
}
