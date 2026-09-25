import { useEffect, useRef } from "react";

/**
 * Run a resync when the event stream comes back after dropping.
 *
 * # Why this is needed at all
 *
 * The node does not buffer. From `crates/server/src/sse/events.rs`:
 *
 * > Events that occur during disconnection are **not buffered** and will be
 * > skipped
 *
 * So a dropped stream is not a delay, it is a hole: every message, edit,
 * reaction and role change in that window is gone as far as this client is
 * concerned. Nothing re-reads afterwards, because every refresh path is driven
 * by an event that will now never arrive.
 *
 * A laptop lid closing is enough to open one. So is a network blip, a sleeping
 * tab, or a node restart.
 *
 * # Why a transition, not a state
 *
 * Only false → true is a reconnect. The FIRST connect is not: whatever mounted
 * the app is already fetching, and resyncing on top of that would double every
 * load. `wasOffline` exists to tell those apart, and starts false so a normal
 * startup is silent.
 *
 * @param isOnline Live connection state — `useMero().isOnline`, which mero-react
 *   drives from the SSE `connect` and `error` callbacks, not from
 *   `navigator.onLine`. It reflects this stream, which is the thing that can
 *   lose events.
 * @param onReconnect What to re-read. Called once per reconnection.
 */
export function useReconnectResync(
  isOnline: boolean,
  onReconnect: () => void,
): void {
  const wasOffline = useRef(false);
  // Held in a ref so a caller that rebuilds the callback every render — which
  // is most of them — does not re-arm the effect and fire a resync per render.
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;

    wasOffline.current = false;
    onReconnectRef.current();
  }, [isOnline]);
}
