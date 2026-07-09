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
import { columnLabel, sheetPrefix } from './refs';

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

/** Last non-space character already emitted — used to tell a range's start ref
 *  (qualifiable) from its end ref (`prev === ':'`, inherits the start's sheet)
 *  and from an already-qualified ref (`prev === '!'`). */
function lastNonSpace(s: string): string {
  let j = s.length - 1;
  while (j >= 0 && (s[j] === ' ' || s[j] === '\t')) j--;
  return j >= 0 ? s[j] : '';
}

/**
 * Scan a formula and rewrite each real cell-ref token via `onRef`, leaving
 * sheet-name qualifiers, function names, and string literals verbatim. Shared
 * by shiftFormula (relative math) and qualifyFormula (cross-sheet qualifying).
 * `onRef` receives the token and the previous non-space output char.
 */
function transformRefs(
  formula: string,
  onRef: (token: string, prevChar: string) => string,
): string {
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
    if (ch === '"') {
      // Double-quoted string literal (e.g. an IF label). Copy it verbatim
      // through the closing quote so ref-shaped text inside — "Q1", "FY2024" —
      // is never rewritten. The engine's strings are simple/unescaped.
      out += ch;
      i++;
      while (i < formula.length) {
        out += formula[i];
        if (formula[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
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
      out += onRef(token, lastNonSpace(out));
      i += token.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  return transformRefs(formula, (token) => {
    const shifted = shiftRef(token, dRow, dCol);
    return shifted === null ? '#REF!' : shifted;
  });
}

/**
 * Qualify every BARE cell reference in a formula with `sheetName`, so a formula
 * copied to another sheet keeps pointing at the source sheet's data
 * (`=SUM(A9:F9)` → `=SUM(Sheet1!A9:F9)`). Refs that already carry a sheet
 * qualifier (prev `!`) and the end of a range (prev `:`, which inherits the
 * start's sheet — the engine's `split_sheet_qualifier` reads one qualifier per
 * range) are left untouched. Absolute `$` markers are preserved.
 */
export function qualifyFormula(formula: string, sheetName: string): string {
  const prefix = sheetPrefix(sheetName);
  return transformRefs(formula, (token, prev) =>
    prev === '!' || prev === ':' ? token : `${prefix}${token}`,
  );
}
