import { useEffect, useRef, useState } from "react";

export function useAutoRefresh(fn: () => Promise<void>, intervalMs: number) {
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);
  const prevRef = useRef<string>("");
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      await fnRef.current();
      if (!cancelled) setLastSynced(new Date());
    }

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  // Pulse the indicator whenever lastSynced changes.
  useEffect(() => {
    if (!lastSynced) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(t);
  }, [lastSynced]);

  function sinceLabel() {
    if (!lastSynced) return "…";
    const secs = Math.round((Date.now() - lastSynced.getTime()) / 1000);
    if (secs < 2) return "just now";
    return `${secs}s ago`;
  }

  return { lastSynced, pulse, sinceLabel };
}
