const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
}); // "Sep 22"
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}); // "Dec 31, 2025"

/** When something happened, mid-sentence: "just now", "2 min ago", "3 h ago", "yesterday", then a date. */
export function whenLabel(ms: number, nowMs: number): string {
  const ago = nowMs - ms;
  if (ago < MINUTE_MS) return 'just now'; // a peer's clock may run ahead
  if (ago < HOUR_MS) return `${Math.floor(ago / MINUTE_MS)} min ago`;
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  if (ms >= today.getTime()) return `${Math.floor(ago / HOUR_MS)} h ago`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (ms >= yesterday.getTime()) return 'yesterday';
  return dateLabel(ms, nowMs);
}

/** A day as a date: "Sep 22", or "Dec 31, 2025" outside this year. */
export function dateLabel(ms: number, nowMs: number): string {
  const sameYear =
    new Date(ms).getFullYear() === new Date(nowMs).getFullYear();
  return (sameYear ? DAY_FORMAT : DAY_YEAR_FORMAT).format(ms);
}

/** When a doc changed, as a list shows it: "2 min ago", "3 h ago", "Yesterday", then a date. */
export function updatedLabel(ms: number, nowMs: number): string {
  const label = whenLabel(ms, nowMs);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** When this device last opened a doc: "opened 4 min ago", "opened yesterday". */
export function openedLabel(ms: number, nowMs: number): string {
  return `opened ${whenLabel(ms, nowMs)}`;
}
