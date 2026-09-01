/** Truncate a long string in the middle: "abcdefghij…uvwxyz". */
export function truncateMiddle(s: string, head = 12, tail = 8): string {
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
