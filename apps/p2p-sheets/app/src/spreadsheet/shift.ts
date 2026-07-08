/**
 * Shift every cell/range reference in a formula by (dRow, dCol), leaving
 * `$`-anchored components fixed. Pure; the engine that fill and (later)
 * copy/paste share for relative/absolute reference math.
 *
 * A reference token is `[$]?LETTERS[$]?DIGITS`. A token immediately followed by
 * `!` is a sheet-name qualifier (e.g. `Data!`, or `DATA2!`), not a cell ref, so
 * it is copied verbatim; the cell ref after the `!` still shifts. Quoted sheet
 * names (`'Q1 2026'!`) are skipped wholesale so digits inside them never shift.
 * A shift that lands out of range (row < 1 or col < 0) becomes `#REF!`.
 *
 * v1 does not shift whole-column/row refs (`A:A`, `1:1`) — they pass through.
 */
import { columnLabel } from './refs';

const REF_RE = /^\$?[A-Z]+\$?\d+/;

function lettersToCol(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); // A=1
  return n - 1; // 0-based
}

function shiftRef(token: string, dRow: number, dCol: number): string | null {
  const m = /^(\$?)([A-Z]+)(\$?)(\d+)$/.exec(token);
  if (!m) return token;
  const [, colAbs, letters, rowAbs, digits] = m;
  let col = lettersToCol(letters);
  let row = parseInt(digits, 10) - 1;
  if (!colAbs) col += dCol;
  if (!rowAbs) row += dRow;
  if (col < 0 || row < 0) return null; // out of range
  return `${colAbs}${columnLabel(col)}${rowAbs}${row + 1}`;
}

export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (!formula.startsWith('=')) return formula;
  let out = '';
  let i = 0;
  let inQuote = false;
  while (i < formula.length) {
    const ch = formula[i];
    if (inQuote) {
      out += ch;
      if (ch === "'") {
        if (formula[i + 1] === "'") { out += "'"; i += 2; continue; }
        inQuote = false;
      }
      i++;
      continue;
    }
    if (ch === "'") { inQuote = true; out += ch; i++; continue; }
    const m = REF_RE.exec(formula.slice(i));
    if (m) {
      const token = m[0];
      const next = formula[i + token.length];
      if (next === '!' || next === '(') {
        // `!` → sheet-name qualifier; `(` → function name ending in digits
        // (e.g. ATAN2, LOG10). Neither is a cell ref — copy verbatim.
        out += token;
        i += token.length;
        continue;
      }
      const shifted = shiftRef(token, dRow, dCol);
      out += shifted === null ? '#REF!' : shifted;
      i += token.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
