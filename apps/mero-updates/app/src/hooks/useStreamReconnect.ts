import { useEffect, useRef } from "react";
import { useMero } from "@calimero-network/mero-react";

/** How long after a (re)connect to wait before re-reading state. */
const RESYNC_DELAY_MS = 500;

/**
 * Call `onReconnect` whenever the node"s event stream (re)opens.
 *
 * A stream that drops and comes back — the node was stopped and started
 * again, the laptop slept, the network blipped — reconnects and re-subscribes
 * on its own, but every event from while it was down is gone for good, and so
 * is anything between the node coming back and the client"s next retry.
 * Nothing replays them, so a page that only refetches on events kept its
 * pre-outage state until it was re-mounted.
 *
 * It fires on EVERY `connect` it sees, the first included: this hook can
 * mount mid-outage, when the next connect is a reconnect, and one spare read
 * at startup costs nothing. Deferred so the re-subscribe `SseClient` sends
 * right after `connect` lands first — read before it, and a write in between
 * is lost.
 */
export function useStreamReconnect(onReconnect: () => void): void {
  const { mero } = useMero();
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    const sse = mero?.events;
    if (!sse) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onConnect = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onReconnectRef.current();
      }, RESYNC_DELAY_MS);
    };
    sse.on("connect", onConnect);
    return () => {
      if (timer) clearTimeout(timer);
      sse.off("connect", onConnect);
    };
  }, [mero]);
}
