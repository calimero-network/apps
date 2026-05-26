import { useEffect, useRef, useCallback, useState } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

// Online = heartbeat seen within this window. 10s = 2× the 5s poll interval.
export const THRESHOLD_MS = 10_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;

interface UsePresenceResult {
  isOnline: (identity: string) => boolean;
  // For 2-person DMs: true if ANY key other than `myKey` has a recent heartbeat.
  // Use this when you can't guarantee `dm.otherIdentity` is a context executor key
  // (e.g. getProfiles hasn't resolved yet and it's still a namespace member key).
  hasOtherOnline: (myKey: string) => boolean;
}

/**
 * Registers the local user as online in `contextId` (by calling `heartbeat`
 * every 30 s) and polls `get_presence` to find out who else is online.
 *
 * Returns `isOnline(identity)` — reads from state so the component re-renders
 * when the online set changes, making dots appear/disappear correctly.
 *
 * Pass `undefined` for either argument to disable the hook (no calls made).
 */
export function usePresence(
  contextId: string | undefined,
  executorPublicKey: string | undefined,
): UsePresenceResult {
  // State drives re-renders; ref keeps the latest set for the stable callback.
  const [onlineSet, setOnlineSet] = useState<Set<string>>(new Set());
  const onlineRef = useRef<Set<string>>(new Set());

  const runHeartbeat = useCallback(async () => {
    if (!contextId || !executorPublicKey) return;
    const api = new ClientApiDataSource();
    await api.heartbeat(contextId, executorPublicKey);
  }, [contextId, executorPublicKey]);

  const refreshPresence = useCallback(async () => {
    if (!contextId || !executorPublicKey) return;
    const api = new ClientApiDataSource();
    const resp = await api.getPresence(contextId, executorPublicKey, THRESHOLD_MS * 1_000_000);
    if (resp.data) {
      const next = new Set(resp.data);
      onlineRef.current = next;
      setOnlineSet(next);
    }
  }, [contextId, executorPublicKey]);

  useEffect(() => {
    if (!contextId || !executorPublicKey) return;

    // Fire immediately on mount, then on the interval.
    void runHeartbeat();
    void refreshPresence();

    const id = setInterval(() => {
      void runHeartbeat();
      void refreshPresence();
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(id);
  }, [contextId, executorPublicKey, runHeartbeat, refreshPresence]);

  // Read from state (not ref) so callers re-render when the set changes.
  const isOnline = useCallback(
    (identity: string) => onlineSet.has(identity),
    [onlineSet],
  );

  const hasOtherOnline = useCallback(
    (myKey: string) =>
      onlineSet.size > 1 || (onlineSet.size === 1 && !onlineSet.has(myKey)),
    [onlineSet],
  );

  return { isOnline, hasOtherOnline };
}
