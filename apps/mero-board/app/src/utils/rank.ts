/**
 * Fractional-index ranks, the same algorithm as logic/src/rank.rs: a base-36
 * fraction in (0, 1) over `0-9a-z`, never empty, never ending in `0`.
 * Siblings sort by `(rank, id)`. The contract validates; clients compute.
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    if (a >= b) throw new Error(`midpoint needs a < b (${a} >= ${b})`);
    let n = 0;
    while (n < b.length && (a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.floor((digitA + digitB + 1) / 2)];
  }
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a ? a.slice(1) : '', null);
}

/** A rank strictly between two neighbours; `null` on either side is the edge. */
export function rankBetween(before: string | null, after: string | null): string {
  // Two siblings can share a rank (concurrent moves on two nodes picked the same
  // neighbour pair). A degenerate pair has no rank strictly between, so land
  // after `before` rather than throwing.
  if (before !== null && after !== null && before >= after) return rankAfter(before);
  return midpoint(before ?? '', after);
}

/** A rank after the current last sibling. */
export function rankAfter(last: string | null): string {
  return rankBetween(last, null);
}

/**
 * The rank for inserting at `index` into `siblings`, which must already be
 * sorted by rank and must not contain the item being placed. A card dropped
 * into a group of equal ranks lands after the group: `after` is the first
 * sibling at or past `index` whose rank is strictly greater than `before`.
 */
export function rankFor(siblings: ReadonlyArray<{ rank: string }>, index: number): string {
  const before = index > 0 ? siblings[index - 1]?.rank ?? null : null;
  let after: string | null = null;
  for (let i = index; i < siblings.length; i++) {
    const r = siblings[i].rank;
    if (before === null || r > before) {
      after = r;
      break;
    }
  }
  return rankBetween(before, after);
}

/** Sort key used everywhere a sibling list is shown. */
export function byRank<T extends { rank: string; id: string }>(a: T, b: T): number {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
