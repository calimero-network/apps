/**
 * Standup days, as the contract keys them: `YYYY-MM-DD`.
 *
 * The day is the member's LOCAL date. The contract cannot know anyone's time
 * zone, so "today" is decided here, by the browser, and two members on
 * different sides of midnight post for different days. That is the honest
 * answer for an async standup — Monday's update is Monday where you are.
 *
 * Pure: no React, no node, so every edge is unit-tested.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `date` as `YYYY-MM-DD` in the browser's local time zone. */
export function dayOf(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today, locally. */
export function today(now: Date = new Date()): string {
  return dayOf(now);
}

/** Local noon on `day`, or null if it is not a real date. Noon, so a DST
 *  shift can never move the result onto a neighbouring day. */
export function parseDay(day: string): Date | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 12);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    ? date
    : null;
}

/** `day` moved by `delta` days. Returns `day` unchanged if it is not a date. */
export function shiftDay(day: string, delta: number): string {
  const date = parseDay(day);
  if (!date) return day;
  date.setDate(date.getDate() + delta);
  return dayOf(date);
}

/** "Today", "Yesterday", or a short weekday and date, relative to `now`. */
export function describeDay(day: string, now: Date = new Date()): string {
  const t = today(now);
  if (day === t) return "Today";
  if (day === shiftDay(t, -1)) return "Yesterday";
  if (day === shiftDay(t, 1)) return "Tomorrow";
  const date = parseDay(day);
  if (!date) return day;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** A contract timestamp (nanoseconds) as a short local time or date. */
export function describeTime(nanos: number, now: Date = new Date()): string {
  const date = new Date(Math.floor(nanos / 1e6));
  if (Number.isNaN(date.getTime())) return "";
  return dayOf(date) === dayOf(now)
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * "just now", "5m ago", "3h ago", "yesterday", or a short date — for bylines,
 * where an exact clock time is noise. `nanos` is a contract timestamp.
 */
export function relativeTime(nanos: number, now: Date = new Date()): string {
  const then = new Date(Math.floor(nanos / 1e6));
  if (Number.isNaN(then.getTime()) || nanos <= 0) return "";
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (dayOf(then) === dayOf(now) && hours < 24) return `${hours}h ago`;
  if (dayOf(then) === shiftDay(dayOf(now), -1)) return "yesterday";
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** The Monday of `day`'s week. Standup weeks start on Monday. */
export function weekStart(day: string): string {
  const date = parseDay(day);
  if (!date) return day;
  const offset = (date.getDay() + 6) % 7; // Mon=0 … Sun=6
  return shiftDay(day, -offset);
}

/** The seven days starting at `start`. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
}

/** "Mon", "Tue", … for a day. */
export function weekdayShort(day: string): string {
  const date = parseDay(day);
  return date ? date.toLocaleDateString(undefined, { weekday: "short" }) : day;
}

/** "Oct 12 – 18" (or across months, "Oct 27 – Nov 2") for a week. */
export function describeWeek(start: string): string {
  const a = parseDay(start);
  const b = parseDay(shiftDay(start, 6));
  if (!a || !b) return start;
  const left = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const right =
    a.getMonth() === b.getMonth()
      ? String(b.getDate())
      : b.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${left} – ${right}`;
}
