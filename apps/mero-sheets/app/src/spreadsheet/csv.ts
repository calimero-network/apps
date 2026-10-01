/**
 * Reading CSV (RFC 4180): quoted fields with doubled quotes and line breaks,
 * CRLF or LF, and the delimiter guessed from the first line (comma,
 * semicolon or tab) so exports from other locales and TSV come in right.
 */

export function guessDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (d: string) => firstLine.split(d).length - 1;
  return ['\t', ';', ','].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
}

/** Rows of fields. A trailing newline does not add an empty row. */
export function parseCsv(text: string, delimiter = guessDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
