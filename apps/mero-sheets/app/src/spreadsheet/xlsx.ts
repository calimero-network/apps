/**
 * XLSX in and out, on top of fflate (an .xlsx is a zip of XML parts).
 *
 * Writes every sheet with its values and formulas (and each formula's last
 * computed value, so a reader that does not recalculate still shows it).
 * Reads values, formulas (including Excel's shared formulas, re-based cell by
 * cell) and sheet names. Styles and number formats are not carried either way.
 *
 * Formulas cross the boundary in display form with sheet NAMES
 * (`='Sheet 2'!A1*2`); the caller turns them into and out of stored form.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { columnLabel } from './refs';
import { shiftFormula } from './shift';

export interface BookCell {
  row: number;
  col: number;
  /** A literal, or `=` and a formula. */
  raw: string;
  /** The formula's computed value (ignored for literals). */
  computed?: string;
}

export interface BookSheet {
  name: string;
  cells: BookCell[];
}

const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Characters XML 1.0 cannot carry at all.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const unesc = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  const k = e.toLowerCase();
  if (k === 'amp') return '&';
  if (k === 'lt') return '<';
  if (k === 'gt') return '>';
  if (k === 'quot') return '"';
  if (k === 'apos') return "'";
  return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});

/** `B3` for row 2, column 1. */
export const cellName = (row: number, col: number) => `${columnLabel(col)}${row + 1}`;

/** The row and column of `B3`, or null. */
export function parseCellName(name: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(name.toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

/** Sheet names Excel accepts: no `[]:*?/\`, at most 31 characters, unique. */
export function excelSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n, i) => {
    const base = (n.replace(/[[\]:*?/\\]/g, ' ').trim() || `Sheet ${i + 1}`).slice(0, 31);
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base.slice(0, 31 - String(k).length - 1)} ${k}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml({ row, col, raw, computed }: BookCell): string {
  const r = cellName(row, col);
  if (raw.startsWith('=')) {
    const f = `<f>${esc(raw.slice(1))}</f>`;
    const v = computed ?? '';
    if (v === '') return `<c r="${r}">${f}</c>`;
    return NUMBER.test(v) ? `<c r="${r}">${f}<v>${v}</v></c>` : `<c r="${r}" t="str">${f}<v>${esc(v)}</v></c>`;
  }
  if (NUMBER.test(raw.trim())) return `<c r="${r}"><v>${raw.trim()}</v></c>`;
  const upper = raw.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') return `<c r="${r}" t="b"><v>${upper === 'TRUE' ? 1 : 0}</v></c>`;
  return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${esc(raw)}</t></is></c>`;
}

function sheetXml(cells: BookCell[]): string {
  const rows = new Map<number, BookCell[]>();
  for (const c of cells) {
    if (c.raw === '') continue;
    const list = rows.get(c.row) ?? [];
    list.push(c);
    rows.set(c.row, list);
  }
  const body = [...rows.keys()].sort((a, b) => a - b).map((r) => {
    const cs = rows.get(r)!.sort((a, b) => a.col - b.col).map(cellXml).join('');
    return `<row r="${r + 1}">${cs}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** An .xlsx of these sheets. */
export function writeXlsx(sheets: BookSheet[]): Uint8Array {
  const names = excelSheetNames(sheets.map((s) => s.name));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${
  sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
  names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
  sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.cells)); });
  return zipSync(files, { level: 6 });
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? unesc(m[1]) : null;
};

/** The text of every `<t>` in a fragment, joined (rich text runs included). */
const texts = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');

/** The sheets of an .xlsx, as cells of literals and `=` formulas. */
export function readXlsx(bytes: Uint8Array): BookSheet[] {
  const zip = unzipSync(bytes);
  const read = (path: string) => (zip[path] ? strFromU8(zip[path]) : null);
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('Not a spreadsheet: no workbook inside');
  const rels = new Map<string, string>();
  for (const m of (read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => texts(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));

  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = attr(m[0], 'name') ?? 'Sheet';
    const path = rels.get(attr(m[0], 'r:id') ?? '') ?? '';
    const xml = read(path) ?? '';
    const masters = new Map<string, { at: { row: number; col: number }; text: string }>();
    const cells: BookCell[] = [];
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = parseCellName(attr(c[1], 'r') ?? '');
      if (!at) continue;
      const inner = c[2] ?? '';
      const type = attr(c[1], 't');
      const fTag = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
      let raw: string | null = null;
      if (fTag) {
        let text = unesc(fTag[2] ?? '');
        const si = attr(fTag[1], 'si');
        if (attr(fTag[1], 't') === 'shared' && si !== null) {
          const master = masters.get(si);
          if (text) masters.set(si, { at, text });
          else if (master) text = shiftFormula(`=${master.text}`, at.row - master.at.row, at.col - master.at.col).slice(1);
        }
        if (text) raw = `=${text}`;
      }
      if (raw === null) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (type === 's') raw = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') raw = texts(inner);
        else if (type === 'b') raw = v === '1' ? 'TRUE' : 'FALSE';
        else raw = v === undefined ? '' : unesc(v);
      }
      if (raw !== '') cells.push({ ...at, raw });
    }
    return { name, cells };
  });
}
