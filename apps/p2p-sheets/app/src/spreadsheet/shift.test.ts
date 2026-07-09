import { describe, it, expect } from 'vitest';
import { shiftFormula } from './shift';

describe('shiftFormula', () => {
  it('shifts relative refs by the offset', () => {
    expect(shiftFormula('=A1', 1, 0)).toBe('=A2');
    expect(shiftFormula('=A1', 0, 1)).toBe('=B1');
    expect(shiftFormula('=B3*2', 2, 1)).toBe('=C5*2');
  });

  it('keeps absolute components fixed', () => {
    expect(shiftFormula('=$A$1', 3, 3)).toBe('=$A$1');
    expect(shiftFormula('=$A1', 1, 1)).toBe('=$A2');   // col fixed, row shifts
    expect(shiftFormula('=A$1', 1, 1)).toBe('=B$1');   // row fixed, col shifts
  });

  it('shifts each endpoint of a range', () => {
    expect(shiftFormula('=SUM(A1:A2)', 1, 0)).toBe('=SUM(A2:A3)');
    expect(shiftFormula('=SUM($A$1:A2)', 1, 0)).toBe('=SUM($A$1:A3)');
  });

  it('shifts the cell part of a cross-sheet ref, keeping the sheet', () => {
    expect(shiftFormula('=Data!A1', 1, 0)).toBe('=Data!A2');
    expect(shiftFormula("='Q1 2026'!A1", 0, 1)).toBe("='Q1 2026'!B1");
  });

  it('turns an out-of-range shift into #REF!', () => {
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');   // row 1 → row 0
    expect(shiftFormula('=A1', 0, -1)).toBe('=#REF!');   // col A → col -1
  });

  it('does not shift a function name that ends in digits', () => {
    expect(shiftFormula('=ATAN2(A1)', 1, 0)).toBe('=ATAN2(A2)');
    expect(shiftFormula('=LOG10(A1)+B2', 1, 0)).toBe('=LOG10(A2)+B3');
  });

  it('leaves literals and zero-offset formulas unchanged', () => {
    expect(shiftFormula('42', 5, 5)).toBe('42');
    expect(shiftFormula('hello', 5, 5)).toBe('hello');
    expect(shiftFormula('=A1+B2', 0, 0)).toBe('=A1+B2');
  });

  it('does not shift ref-like text inside double-quoted string literals', () => {
    // A label that looks like a ref must survive verbatim...
    expect(shiftFormula('="A1 total"', 1, 0)).toBe('="A1 total"');
    // ...while real refs around the string still shift.
    expect(shiftFormula('=IF(A1>0,"Q1",A1)', 1, 0)).toBe('=IF(A2>0,"Q1",A2)');
    expect(shiftFormula('=A1&" FY2024"', 0, 1)).toBe('=B1&" FY2024"');
  });
});
