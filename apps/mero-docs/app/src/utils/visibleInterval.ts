/**
 * setInterval for a safety-net poll: ticks are skipped while the tab is
 * hidden, and one runs as soon as it becomes visible again, so a background
 * tab stops reading from the node and a returning one catches up at once.
 *
 * Ticks fall on the wall clock's multiples of `ms`, so every poll of the same
 * period runs in the same instant: what they read in common (the org, the
 * account's apps, `/me`) is then read once and served from the short-lived
 * caches to the rest, instead of once per poll at its own phase.
 * Returns the cleanup.
 */
export function visibleInterval(tick: () => void, ms: number): () => void {
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const run = () => {
    if (!hidden()) tick();
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    run();
    interval = setInterval(run, ms);
  }, ms - (Date.now() % ms));
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', run);
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', run);
  };
}
