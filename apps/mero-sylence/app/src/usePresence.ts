import { useEffect, useState } from "react";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keeps something mounted for `ms` after `open` turns false, so it can play
 * its closing animation: `closing` is true for that while.
 */
export function usePresence(open: boolean, ms = 150): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const t = setTimeout(() => setMounted(false), reducedMotion() ? 0 : ms);
    return () => clearTimeout(t);
  }, [open, mounted, ms]);
  return { mounted: mounted || open, closing: mounted && !open };
}
