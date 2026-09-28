import { useEffect, useState } from 'react';

const CLOCK_TICK_MS = 60_000; // "2 min ago" labels and the Updated window move on

/** The time, moving once a minute, so Home and the sidebar judge "updated" windows alike. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
