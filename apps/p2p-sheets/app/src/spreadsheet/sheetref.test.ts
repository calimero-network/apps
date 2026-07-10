import { describe, it, expect } from 'vitest';
import { idsToNames, namesToIds } from './sheetref';

const NAME: Record<string, string> = { 'sheet-1-aa': 'Data', 'sheet-2-bb': 'Q3 Budget' };
const ID: Record<string, string> = { Data: 'sheet-1-aa', 'Q3 Budget': 'sheet-2-bb' };
const nameOf = (id: string) => NAME[id] ?? null;
const idOf = (name: string) => ID[name] ?? null;

describe('idsToNames', () => {
  it('renders a bare-name qualifier', () => {
    expect(idsToNames('=[sheet-1-aa]!A1', nameOf)).toBe('=Data!A1');
  });
  it('quotes a name that needs quoting and qualifies a range once', () => {
    expect(idsToNames('=SUM([sheet-2-bb]!A9:F9)', nameOf)).toBe("=SUM('Q3 Budget'!A9:F9)");
  });
  it('leaves an unknown id untouched', () => {
    expect(idsToNames('=[sheet-x]!A1', nameOf)).toBe('=[sheet-x]!A1');
  });
  it('does not touch ids inside string literals', () => {
    expect(idsToNames('="[sheet-1-aa]!A1"', nameOf)).toBe('="[sheet-1-aa]!A1"');
  });
  it('passes through non-formula text', () => {
    expect(idsToNames('42', nameOf)).toBe('42');
  });
});

describe('namesToIds', () => {
  it('maps a bare name qualifier to its id', () => {
    expect(namesToIds('=Data!A1', idOf)).toBe('=[sheet-1-aa]!A1');
  });
  it('maps a quoted name and qualifies a range once', () => {
    expect(namesToIds("=SUM('Q3 Budget'!A9:F9)", idOf)).toBe('=SUM([sheet-2-bb]!A9:F9)');
  });
  it('leaves a same-sheet cell ref alone', () => {
    expect(namesToIds('=A1+B2', idOf)).toBe('=A1+B2');
  });
  it('leaves an unknown name verbatim', () => {
    expect(namesToIds('=Ghost!A1', idOf)).toBe('=Ghost!A1');
  });
  it('does not touch names inside string literals', () => {
    expect(namesToIds('="Data!A1"', idOf)).toBe('="Data!A1"');
  });
});

describe('round-trip', () => {
  it('names → ids → names is identity for known sheets', () => {
    const display = "=SUM(Data!A1, 'Q3 Budget'!B2:C4)";
    expect(idsToNames(namesToIds(display, idOf), nameOf)).toBe(display);
  });
});
