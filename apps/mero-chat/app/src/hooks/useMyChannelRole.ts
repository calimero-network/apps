import { useCallback, useEffect, useRef, useState } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { Role } from "../api/clientApi";
import { useWebSocketEvents } from "../contexts/WebSocketContext";
import type { WebSocketEvent } from "../types/WebSocketTypes";

/**
 * Resolve the current user's app-level moderation role inside a channel
 * context. Reacts immediately to `RoleUpdated` SSE events in the context,
 * and re-reads when the tab becomes visible again (events missed while it
 * was hidden). There is no timer: the events already cover every change.
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
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
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
