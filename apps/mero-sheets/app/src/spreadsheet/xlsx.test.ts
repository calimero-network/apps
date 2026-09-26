import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { excelSheetNames, parseCellName, readXlsx, writeXlsx } from './xlsx';
import { guessDelimiter, parseCsv } from './csv';

describe('xlsx round trip', () => {
  it('keeps values, formulas and sheet names', () => {
    const bytes = writeXlsx([
      { name: 'Budget', cells: [
        { row: 0, col: 0, raw: 'Item & <cost>' },
        { row: 0, col: 1, raw: '12.5' },
        { row: 1, col: 1, raw: '=B1*2', computed: '25' },
        { row: 2, col: 0, raw: 'TRUE' },
        { row: 2, col: 27, raw: "='Other sheet'!A1", computed: 'hi' },
      ] },
      { name: 'Other sheet', cells: [{ row: 0, col: 0, raw: 'hi' }] },
    ]);
    const back = readXlsx(bytes);
    expect(back.map((s) => s.name)).toEqual(['Budget', 'Other sheet']);
    expect(back[0].cells).toEqual([
      { row: 0, col: 0, raw: 'Item & <cost>' },
      { row: 0, col: 1, raw: '12.5' },
      { row: 1, col: 1, raw: '=B1*2' },
      { row: 2, col: 0, raw: 'TRUE' },
      { row: 2, col: 27, raw: "='Other sheet'!A1" },
    ]);
  });
});

describe('readXlsx', () => {
  it('reads shared strings and re-bases shared formulas', () => {
    const file = (s: string) => strToU8(s);
    const bytes = zipSync({
      'xl/workbook.xml': file('<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': file('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/s.xml"/></Relationships>'),
      'xl/sharedStrings.xml': file('<sst><si><t>plain</t></si><si><r><t>rich </t></r><r><t>text</t></r></si></sst>'),
      'xl/worksheets/s.xml': file(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2"><v>1</v></c><c r="B2"><f t="shared" ref="B2:B3" si="0">A2*10</f><v>10</v></c></row>' +
        '<row r="3"><c r="A3"><v>2</v></c><c r="B3"><f t="shared" si="0"/><v>20</v></c></row></sheetData></worksheet>'),
    });
    expect(readXlsx(bytes)[0].cells).toEqual([
      { row: 0, col: 0, raw: 'plain' },
      { row: 0, col: 1, raw: 'rich text' },
      { row: 1, col: 0, raw: '1' },
      { row: 1, col: 1, raw: '=A2*10' },
      { row: 2, col: 0, raw: '2' },
      { row: 2, col: 1, raw: '=A3*10' },
    ]);
  });

  it('refuses a file with no workbook', () => {
    expect(() => readXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/Not a spreadsheet/);
  });
});

describe('names', () => {
  it('parses cell names and makes Excel-safe unique sheet names', () => {
    expect(parseCellName('AB12')).toEqual({ row: 11, col: 27 });
    expect(parseCellName('12')).toBeNull();
    expect(excelSheetNames(['Q1/Q2', 'Q1 Q2', 'x'.repeat(40)])).toEqual(['Q1 Q2', 'Q1 Q2 2', 'x'.repeat(31)]);
  });
});

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and line breaks in a field', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
  });
  it('guesses semicolons and tabs', () => {
    expect(guessDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('drops a byte-order mark and keeps empty fields', () => {
    expect(parseCsv('﻿x,,y')).toEqual([['x', '', 'y']]);
  });
});
