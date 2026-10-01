/** Node timestamps are nanoseconds since the Unix epoch. */
export function nsToMs(ns: number): number {
  return Math.floor(ns / 1_000_000);
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function ago(ms: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
