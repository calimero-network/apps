/**
 * Sorting a range: reorder its rows by one column, as cell writes.
 *
 * Each row's cells move together. A formula that moves shifts its relative
 * references by the distance it moved (as a copy would), so `=B2*2` sorted
 * from row 2 to row 5 reads `=B5*2`. Blanks sort last either way; numbers
 * before text; text without regard to case; ties keep their order.
 */
import { shiftFormula } from './shift';
import type { CellCoord, Rect } from './refs';

export interface SortCell {
  raw: string;
  format: string;
  computed: string;
}

export interface SortWrite {
  row: number;
  col: number;
  raw: string;
  format: string;
}

type CellAt = (row: number, col: number) => SortCell | null;

const isNumber = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));

/** Order two sort keys: blanks last, numbers before text. */
export function compareKeys(a: string, b: string, ascending: boolean): number {
  const ea = a.trim() === '';
  const eb = b.trim() === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = isNumber(a);
  const nb = isNumber(b);
  let order: number;
  if (na && nb) order = Number(a) - Number(b);
  else if (na !== nb) order = na ? -1 : 1;
  else order = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  return ascending ? order : -order;
}

/**
 * Where each row of the sorted range comes from: `order[i]` is the source
 * row now at `top + i` (header excluded).
 */
export function sortOrder(rect: Rect, keyCol: number, ascending: boolean, header: boolean, cellAt: CellAt): number[] {
  const first = rect.top + (header ? 1 : 0);
  const rows = Array.from({ length: rect.bottom - first + 1 }, (_, i) => first + i);
  const key = (r: number) => cellAt(r, keyCol)?.computed ?? '';
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((x, y) => compareKeys(x.k, y.k, ascending) || x.i - y.i)
    .map((x) => x.r);
}

/** The writes that sort `rect` by `keyCol`: only cells whose content changes. */
export function planSort(rect: Rect, keyCol: number, ascending: boolean, header: boolean, cellAt: CellAt): SortWrite[] {
  const order = sortOrder(rect, keyCol, ascending, header, cellAt);
  const first = rect.top + (header ? 1 : 0);
  const writes: SortWrite[] = [];
  order.forEach((from, i) => {
    const to = first + i;
    if (from === to) return;
    for (let col = rect.left; col <= rect.right; col++) {
      const src = cellAt(from, col);
      const dst = cellAt(to, col);
      const raw = src && src.raw.startsWith('=') ? shiftFormula(src.raw, to - from, 0) : src?.raw ?? '';
      const format = src?.format ?? '';
      if (raw !== (dst?.raw ?? '') || format !== (dst?.format ?? '')) writes.push({ row: to, col, raw, format });
    }
  });
  return writes;
}

/**
 * The block of data around a cell: grown row by row and column by column
 * while the next row or column has anything in it, as spreadsheets pick
 * the range to sort when only one cell is selected.
 */
export function dataRegion(at: CellCoord, rows: number, cols: number, filled: (row: number, col: number) => boolean): Rect {
  const r: Rect = { top: at.row, left: at.col, bottom: at.row, right: at.col };
  const rowHas = (row: number) => {
    for (let c = r.left; c <= r.right; c++) if (filled(row, c)) return true;
    return false;
  };
  const colHas = (col: number) => {
    for (let row = r.top; row <= r.bottom; row++) if (filled(row, col)) return true;
    return false;
  };
  for (let grew = true; grew;) {
    grew = false;
    if (r.top > 0 && rowHas(r.top - 1)) { r.top--; grew = true; }
    if (r.bottom < rows - 1 && rowHas(r.bottom + 1)) { r.bottom++; grew = true; }
    if (r.left > 0 && colHas(r.left - 1)) { r.left--; grew = true; }
    if (r.right < cols - 1 && colHas(r.right + 1)) { r.right++; grew = true; }
  }
  return r;
}

/**
 * Whether the range's first row reads as a header: every cell in it is text
 * (not a number, not blank) and the key column has a number below it.
 */
export function looksLikeHeader(rect: Rect, keyCol: number, cellAt: CellAt): boolean {
  if (rect.bottom <= rect.top) return false;
  for (let c = rect.left; c <= rect.right; c++) {
    const v = cellAt(rect.top, c)?.computed ?? '';
    if (v.trim() === '' || isNumber(v)) return false;
  }
  for (let r = rect.top + 1; r <= rect.bottom; r++) if (isNumber(cellAt(r, keyCol)?.computed ?? '')) return true;
  return false;
}
