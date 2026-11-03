import { useEffect, useRef } from 'react';
import { useMero } from '@/calimero/react';

/** How long after a (re)connect to wait before re-reading state. */
const RESYNC_DELAY_MS = 500;

/**
 * Call `onReconnect` whenever an app instance's event stream (re)opens.
 *
 * A stream that drops and comes back (the cluster moved its leader, the
 * laptop slept, the network blipped) reopens on its own from the last event
 * it saw, but a page should still re-read: it fires on EVERY open, the first
 * included, since this hook can mount mid-outage and one spare read at
 * startup costs nothing.
 */
export function useStreamReconnect(onReconnect: () => void): void {
  const { mero } = useMero();
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    const events = mero?.events;
    if (!events || typeof events.onConnect !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = events.onConnect(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onReconnectRef.current();
      }, RESYNC_DELAY_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [mero]);
}
