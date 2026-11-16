/**
 * setInterval for a safety-net poll: ticks are skipped while the tab is
 * hidden, and one runs as soon as it becomes visible again, so a background
 * tab stops reading from the node and a returning one catches up at once.
 * Returns the cleanup.
 */
export function visibleInterval(tick: () => void, ms: number): () => void {
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  const interval = setInterval(() => {
    if (!hidden()) tick();
  }, ms);
  const onVisible = () => {
    if (!hidden()) tick();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(interval);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}
