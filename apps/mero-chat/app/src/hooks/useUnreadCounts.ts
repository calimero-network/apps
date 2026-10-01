import { useState, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

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
      // Persist to WASM — silently fails if context isn't joined yet.
      const api = new ClientApiDataSource();
      api
        .markAsRead({
          contextId,
          executorPublicKey: contextIdentity,
          timestamp: Math.floor(Date.now() / 1000),
        })
        .catch(() => {});
    },
    [],
  );

  return { counts, loadAll, refreshOne, clearOne };
}
