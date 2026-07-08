/**
 * Spreadsheet cell-reference helpers — the A1 addressing model.
 *
 * Pure functions, no DOM. Shared by the grid, the formula bar, and the
 * formula-editing (point-mode) logic so every part of the app renders and
 * parses references identically.
 */

export interface CellCoord {
  row: number;
  col: number;
}

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** 0-based column index → spreadsheet letters (`0→A`, `25→Z`, `26→AA`). */
export function columnLabel(col: number): string {
  let n = col;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** `A1`-style reference for a 0-based cell. */
export function cellRef(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

/** Inclusive bounding rectangle of two corners (drag order independent). */
export function normalizeRect(a: CellCoord, b: CellCoord): Rect {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

/** Range reference between two corners; a single ref when the corners coincide. */
export function rangeRef(a: CellCoord, b: CellCoord): string {
  if (a.row === b.row && a.col === b.col) return cellRef(a.row, a.col);
  const r = normalizeRect(a, b);
  return `${cellRef(r.top, r.left)}:${cellRef(r.bottom, r.right)}`;
}

/** Whole-column reference (`A:A`). */
export function columnRef(col: number): string {
  const l = columnLabel(col);
  return `${l}:${l}`;
}

/** Whole-row reference (`1:1`, 1-based). */
export function rowRef(row: number): string {
  return `${row + 1}:${row + 1}`;
}

/**
 * Prefix that qualifies a reference with a sheet name (`Data!`, `'Sheet 1'!`).
 * Simple identifier names are left bare; anything with a space or special
 * character is quoted, with internal `'` doubled (Excel/Sheets convention).
 */
export function sheetPrefix(sheetName: string): string {
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(sheetName)) {
    return `${sheetName}!`;
  }
  return `'${sheetName.replace(/'/g, "''")}'!`;
}
