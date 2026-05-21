import { useCallback, useEffect, useRef, useState } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { Role } from "../api/clientApi";
import { useWebSocketEvents } from "../contexts/WebSocketContext";
import type { WebSocketEvent } from "../types/WebSocketTypes";

const POLL_INTERVAL_MS = 30_000;

/**
 * Resolve the current user's app-level moderation role inside a channel
 * context. Reacts immediately to `RoleUpdated` SSE events in the context
 * and falls back to a 30s poll for any missed events.
 *
 * Default is `"User"` (matches the WASM semantics: absence ↔ `User`).
 *
 * Requires WebSocketProvider in the tree (provided at app root in main.tsx).
 */
export function useMyChannelRole(
  contextId: string | undefined,
  executorPublicKey: string | undefined,
): Role {
  const [role, setRole] = useState<Role>("User");

  // Keep a stable ref so the SSE callback can call refresh without
  // being added to its own dependency array.
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!contextId || !executorPublicKey) {
      setRole("User");
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      const resp = await new ClientApiDataSource().listRoles({
        contextId,
        executorPublicKey,
      });
      if (cancelled) return;
      if (resp.error || !resp.data) return; // keep last known-good
      const entry = resp.data.find((r) => r.identity === executorPublicKey);
      setRole(entry?.role ?? "User");
    };

    refreshRef.current = refresh;

    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [contextId, executorPublicKey]);

  // Immediately re-fetch when any RoleUpdated event arrives in this context.
  useWebSocketEvents(
    useCallback(
      (event: WebSocketEvent) => {
        if (event.contextId !== contextId) return;
        const hasRoleEvent = event.data?.events?.some(
          (e) => e.kind === "RoleUpdated",
        );
        if (hasRoleEvent) void refreshRef.current();
      },
      [contextId],
    ),
  );

  return role;
}
