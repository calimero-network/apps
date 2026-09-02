/**
 * Translate a formula's sheet qualifiers between the CANONICAL id form
 * (`[sheetId]!A1`, what is stored + evaluated) and the DISPLAY name form
 * (`Data!A1` / `'Q3 Budget'!A1`, what the formula bar shows). Only the qualifier
 * is rewritten; cell/range/function grammar is untouched. `"…"` string literals
 * are skipped so ref-shaped text inside them is never rewritten.
 */
import { sheetPrefix } from './refs';

/** Canonical `[id]!` → display name qualifier. Unknown id → left verbatim. */
export function idsToNames(formula: string, nameOf: (id: string) => string | null): string {
  if (!formula.startsWith('=')) return formula;
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      out += ch; i++;
      while (i < formula.length) { out += formula[i]; if (formula[i] === '"') { i++; break; } i++; }
      continue;
    }
    if (ch === '[') {
      const end = formula.indexOf(']', i + 1);
      if (end !== -1 && formula[end + 1] === '!') {
        const id = formula.slice(i + 1, end);
        const name = nameOf(id);
        out += name != null ? sheetPrefix(name) : `[${id}]!`;
        i = end + 2; // past ']!'
        continue;
      }
    }
    out += ch; i++;
  }
  return out;
}

/** Display name qualifier → canonical `[id]!`. Unknown name → left verbatim. */
export function namesToIds(formula: string, idOf: (name: string) => string | null): string {
  if (!formula.startsWith('=')) return formula;
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      out += ch; i++;
      while (i < formula.length) { out += formula[i]; if (formula[i] === '"') { i++; break; } i++; }
      continue;
    }
    if (ch === "'") {
      // Quoted sheet name: read to the lone closing quote, collapsing `''`.
      let j = i + 1; let name = ''; let terminated = false;
      while (j < formula.length) {
        if (formula[j] === "'") {
          if (formula[j + 1] === "'") { name += "'"; j += 2; }
          else { j += 1; terminated = true; break; }
        } else { name += formula[j]; j++; }
      }
      if (terminated && formula[j] === '!') {
        const id = idOf(name);
        out += id != null ? `[${id}]!` : formula.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      out += formula.slice(i, j); i = j; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      // Alphanumeric run: a trailing '!' makes it a bare sheet-name qualifier;
      // otherwise it is a cell ref (A1) or function name (SUM) — emit verbatim.
      let j = i;
      while (j < formula.length && /[A-Za-z0-9]/.test(formula[j])) j++;
      if (formula[j] === '!') {
        const name = formula.slice(i, j);
        const id = idOf(name);
        out += id != null ? `[${id}]!` : formula.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      out += formula.slice(i, j); i = j; continue;
    }
    out += ch; i++;
  }
  return out;
}
