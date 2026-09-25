/**
 * Positions and ids for inserted rows and columns.
 *
 * Rows and columns are ordered by a position string (decimal digits, compared
 * as strings) — see the recalc crate's `layout` module, which owns the order
 * itself (the grid reads it through the engine's `visible_order`). This side
 * only has to invent a new position between two neighbours, and a new id.
 */

/** Must match `legacy_pos` in logic/crates/recalc/src/layout.rs. */
export function legacyPos(k: number): string {
  return `5${String(k).padStart(9, '0')}`;
}

/** Whether an id is a legacy row/column number (`"12"`, never `"012"`). */
export function isLegacyId(id: string): boolean {
  return /^(0|[1-9]\d*)$/.test(id);
}

/**
 * A position strictly between `a` and `b` (`b` null: after `a`), both decimal
 * digit strings with `a < b`. Midpoint digit where the two first differ by
 * more than one; otherwise keep `a`'s digit and continue as if unbounded above.
 */
export function positionBetween(a: string, b: string | null): string {
  let out = '';
  let upper = b;
  for (let i = 0; ; i++) {
    // Only `b` = `a` followed by zeros has nothing between; generated
    // positions never end in 0, so that is a corrupt input, not a case.
    if (i > a.length + (b?.length ?? 0) + 1) throw new Error(`no position between ${a} and ${b}`);
    const lo = i < a.length ? Number(a[i]) : 0;
    const hi = upper === null ? 10 : i < upper.length ? Number(upper[i]) : 0;
    if (hi - lo > 1) return out + String(Math.floor((lo + hi) / 2));
    out += String(lo);
    // Past this digit `b` no longer bounds us: anything after `a` is below it.
    if (hi - lo === 1) upper = null;
  }
}

/** `count` increasing positions strictly between `a` and `b`. */
export function positionsBetween(a: string, b: string | null, count: number): string[] {
  const out: string[] = [];
  let lo = a;
  for (let i = 0; i < count; i++) {
    lo = positionBetween(lo, b);
    out.push(lo);
  }
  return out;
}

/** A fresh row/column id: a letter first, so it can never read as legacy. */
export function newAxisId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `n${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('')}`;
}

/** One explicit axis entry, as `get_layouts` returns it. */
export interface AxisEntry {
  id: string;
  pos: string;
  deleted: boolean;
}

/** The position of any id: its entry's, or a legacy id's fixed one. */
export function positionOf(id: string, entries: readonly AxisEntry[]): string | null {
  const e = entries.find((x) => x.id === id);
  if (e) return e.pos;
  return isLegacyId(id) ? legacyPos(Number(id)) : null;
}
