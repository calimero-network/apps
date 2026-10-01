import { useEffect, useState } from 'react';

const CLOCK_TICK_MS = 60_000; // "2 min ago" labels and the Updated window move on

/** The current time, re-read on a tick so relative labels stay true. */
export function useNow(tickMs = CLOCK_TICK_MS): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}
