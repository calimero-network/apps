import { useCallback, useEffect, useMemo } from "react";
import { useEphemeral } from "@calimero-network/mero-react";

interface UsePresenceResult {
  isOnline: (identity: string) => boolean;
  // For 2-person DMs: true if ANY key other than `myKey` is present.
  // Use this when you can't guarantee `dm.otherIdentity` is a context executor key
  // (e.g. getProfiles hasn't resolved yet and it's still a namespace member key).
  hasOtherOnline: (myKey: string) => boolean;
}

/**
 * Who else is present in `contextId`.
 *
 * Presence rides the node's ephemeral channel: an encrypted, never-persisted
 * slice with a node-side TTL, republished by the node's own heartbeat tick.
 * Nothing is written to the DAG. The previous implementation called a WASM
 * `heartbeat` every 5 s and polled `get_presence` — DAG writes and a poll loop
 * for a fact that expires in seconds. Both the contract methods and their
 * client bindings are gone.
 *
 * Keys are context executor keys, unchanged from before: the `author` the node
 * stamps on a presence entry IS the per-context identity, which is what
 * callers already pass as `executorPublicKey` and compare against
 * `dm.otherIdentity`. (It is neither the account id nor the device id — those
 * never match and must not be used here.)
 *
 * Pass `undefined` for either argument to disable the hook.
 */
export function usePresence(
  contextId: string | undefined,
  executorPublicKey: string | undefined,
): UsePresenceResult {
  const enabled = Boolean(contextId && executorPublicKey);
  const { peers, setPresence } = useEphemeral<Record<string, never>>(
    enabled ? (contextId as string) : null,
  );

  // Announce ourselves once per context. There is no teardown to write: the
  // node stops republishing when this client goes away, and the entry expires
  // on its own TTL — which is what makes a crashed tab disappear too.
  useEffect(() => {
    if (!enabled) return;
    setPresence({});
  }, [enabled, setPresence]);

  // `peers` excludes our own echo, so every key in it is somebody else.
  const others = useMemo(() => new Set(peers.keys()), [peers]);

  const isOnline = useCallback(
    (identity: string) => others.has(identity),
    [others],
  );

  const hasOtherOnline = useCallback(
    (myKey: string) => {
      for (const key of others) {
        if (key !== myKey) return true;
      }
      return false;
    },
    [others],
  );

  return { isOnline, hasOtherOnline };
}
