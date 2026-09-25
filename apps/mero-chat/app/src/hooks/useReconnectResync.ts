import { useEffect, useRef } from "react";

/** How long after a reconnect to wait before re-reading. */
const RESYNC_DELAY_MS = 500;

/** The one piece of `SseClient` this needs: its `connect` notifications. */
export interface ConnectSource {
  on(event: "connect", handler: (sessionId: string) => void): void;
  off(event: "connect", handler: (sessionId: string) => void): void;
}

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
 * # Why the stream's `connect`, not `isOnline`
 *
 * This used to watch `useMero().isOnline` for a false → true transition, and
 * in the desktop app that transition never happens. The desktop proxies SSE
 * over Tauri IPC and ends a dropped stream CLEANLY — the body just closes, no
 * error — and a retry against a stopped node closes cleanly too. `isOnline`
 * only goes false on an SSE `error`, so it stayed true through the whole
 * outage and no resync ever ran. Measured with the real `proxy_script.js`:
 * a node stopped for 12s and restarted, the stream reconnected, zero errors.
 *
 * Every `SseClient` (re)connect announces itself with `connect`, whatever the
 * transport, so that is what counts.
 *
 * # Which connect is a reconnect
 *
 * The FIRST connect is not one: whatever mounted the app is already fetching,
 * and resyncing on top of that would double every load. If the stream was
 * already up when this mounted (`isOnline`), every connect from here is a
 * reconnect; if not, the first one is the initial connect and is skipped.
 *
 * Deferred by {@link RESYNC_DELAY_MS} so the re-subscribe `SseClient` sends
 * right after emitting `connect` lands first — read before it, and a write in
 * between is lost.
 *
 * @param events The stream — `useMero().mero?.events`.
 * @param isOnline Whether that stream is already connected, read at mount.
 * @param onReconnect What to re-read. Called once per reconnection.
 */
export function useReconnectResync(
  events: ConnectSource | null | undefined,
  isOnline: boolean,
  onReconnect: () => void,
): void {
  // Held in a ref so a caller that rebuilds the callback every render — which
  // is most of them — does not re-arm the listener.
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  useEffect(() => {
    if (!events) return;
    let skipNext = !isOnlineRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onConnect = () => {
      if (skipNext) {
        skipNext = false;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onReconnectRef.current();
      }, RESYNC_DELAY_MS);
    };
    events.on("connect", onConnect);
    return () => {
      if (timer) clearTimeout(timer);
      events.off("connect", onConnect);
    };
  }, [events]);
}
