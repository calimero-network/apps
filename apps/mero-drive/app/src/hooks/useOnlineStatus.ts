import { useEffect, useRef, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

const DEFAULT_OFFLINE_GRACE_MS = 5000;

/** `isOnline` from the SDK is a raw boolean mirroring the shared SSE socket's
 *  last lifecycle event — it flaps to false on any transient error (a failed
 *  subscribe POST, a reconnect blip) with no debounce and no "connecting"
 *  state. This wraps it so the UI shows green immediately, but only surfaces
 *  red after `isOnline` has stayed false continuously past the grace window.
 *  A blip that recovers within the window never shows red. */
export function useOnlineStatus(graceMs = DEFAULT_OFFLINE_GRACE_MS): boolean {
  const { isOnline } = useMero();
  const [display, setDisplay] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOnline) {
      // Recovered (or never dropped): cancel any pending red, show green now.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setDisplay(true);
      return;
    }
    // Offline: start the grace countdown once; don't restart it on re-renders
    // while already counting down.
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setDisplay(false);
    }, graceMs);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [isOnline, graceMs]);

  return display;
}
