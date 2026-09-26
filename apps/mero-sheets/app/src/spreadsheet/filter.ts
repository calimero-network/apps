/**
 * Filter views: hide the rows of a range that do not match, for you alone.
 *
 * A filter view is personal (kept in this browser, never written to the
 * workbook), so filtering to "my tasks" does not change what anyone else
 * sees. Its first row is the header, never hidden; each filtered column keeps
 * the values it shows, and a row is hidden when any filtered column's value
 * is not among them.
 */
import type { Rect } from './refs';

export interface FilterView {
  rect: Rect;
  /** Column (position) → the values shown ("" is blanks). */
  columns: Record<number, string[]>;
}

type ValueAt = (row: number, col: number) => string;

/** The rows a filter view hides. */
export function hiddenRows(view: FilterView | null, valueAt: ValueAt): Set<number> {
  const hidden = new Set<number>();
  if (!view) return hidden;
  const filters = Object.entries(view.columns).map(([col, values]) => ({
    col: Number(col),
    shown: new Set(values.map(normalize)),
  }));
  if (filters.length === 0) return hidden;
  for (let row = view.rect.top + 1; row <= view.rect.bottom; row++) {
    if (filters.some(({ col, shown }) => !shown.has(normalize(valueAt(row, col))))) hidden.add(row);
  }
  return hidden;
}

/** A column's distinct values below the header, sorted, blanks last. */
export function columnValues(view: FilterView, col: number, valueAt: ValueAt): string[] {
  const seen = new Map<string, string>();
  for (let row = view.rect.top + 1; row <= view.rect.bottom; row++) {
    const v = valueAt(row, col).trim();
    if (!seen.has(normalize(v))) seen.set(normalize(v), v);
  }
  return [...seen.values()].sort((a, b) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** The view with `col` showing `values`, or unfiltered when that is all of them. */
export function withColumn(view: FilterView, col: number, values: string[], all: string[]): FilterView {
  const columns = { ...view.columns };
  if (values.length >= all.length) delete columns[col];
  else columns[col] = values;
  return { ...view, columns };
}

function normalize(v: string): string {
  return v.trim().toLowerCase();
}
