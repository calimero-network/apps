import { useCallback } from "react";

import { usePresentAccounts } from "../calimero/presence";

interface UsePresenceResult {
  isOnline: (identity: string) => boolean;
  hasOtherOnline: (myKey: string) => boolean;
}

/**
 * Who is present in a conversation, for the sidebar's online dot: the
 * accounts with the conversation open (their composer publishes presence),
 * polled. v1 published an empty presence from every DM row too; on 1.0 that
 * would hold a stream and a heartbeat per row, so a row only reads.
 */
export function usePresence(
  contextId: string | undefined,
  executorPublicKey: string | undefined,
): UsePresenceResult {
  const present = usePresentAccounts(contextId && executorPublicKey ? contextId : undefined);
  const isOnline = useCallback((identity: string) => present.has(identity), [present]);
  const hasOtherOnline = useCallback(
    (myKey: string) => [...present].some((a) => a !== myKey),
    [present],
  );
  return { isOnline, hasOtherOnline };
}
