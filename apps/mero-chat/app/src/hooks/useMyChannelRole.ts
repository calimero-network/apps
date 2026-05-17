import { useEffect, useState } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { Role } from "../api/clientApi";

const POLL_INTERVAL_MS = 30_000;

/**
 * Resolve the current user's app-level moderation role inside a channel
 * context. Polls every 30s (no SSE channel for governance ops) and
 * silently keeps the last known-good value on transient errors so a
 * single flaky request doesn't briefly unban the input.
 *
 * Default is `"User"` (matches the WASM semantics: absence ↔ `User`).
 */
export function useMyChannelRole(
  contextId: string | undefined,
  executorPublicKey: string | undefined,
): Role {
  const [role, setRole] = useState<Role>("User");

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

    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [contextId, executorPublicKey]);

  return role;
}
