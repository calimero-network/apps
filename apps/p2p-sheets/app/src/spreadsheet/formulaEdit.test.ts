import { describe, it, expect } from 'vitest';
import { isFormula, insertReference } from './formulaEdit';

describe('isFormula', () => {
  it('is true only when the trimmed text starts with =', () => {
    expect(isFormula('=SUM(A1)')).toBe(true);
    expect(isFormula('   =A1')).toBe(true);
    expect(isFormula('42')).toBe(false);
    expect(isFormula('')).toBe(false);
    expect(isFormula('SUM(A1)')).toBe(false);
  });
});

describe('insertReference', () => {
  it('inserts a reference at the caret and places the caret after it', () => {
    // caret right after "=" in "=" (building "=A1")
    const r = insertReference({ text: '=', selStart: 1, selEnd: 1 }, 'A1');
    expect(r.text).toBe('=A1');
    expect(r.caret).toBe(3);
    expect(r.autoRef).toEqual({ start: 1, end: 3 });
  });

  it('inserts inside an existing formula at the caret, not at the end', () => {
    // "=+B2" with caret after "=" → insert A1 → "=A1+B2"
    const r = insertReference({ text: '=+B2', selStart: 1, selEnd: 1 }, 'A1');
    expect(r.text).toBe('=A1+B2');
    expect(r.caret).toBe(3);
  });

  it('replaces the current selection with the reference', () => {
    // select "XX" in "=XX+1" → replace with A1
    const r = insertReference({ text: '=XX+1', selStart: 1, selEnd: 3 }, 'A1');
    expect(r.text).toBe('=A1+1');
    expect(r.caret).toBe(3);
  });

  it('replaces the previous auto-inserted reference when clicking again without typing', () => {
    // After clicking A1 we had "=A1", caret 3, autoRef {1,3}.
    // Clicking B2 (caret still collapsed at 3) should REPLACE A1 → "=B2".
    const r = insertReference(
      { text: '=A1', selStart: 3, selEnd: 3, autoRef: { start: 1, end: 3 } },
      'B2',
    );
    expect(r.text).toBe('=B2');
    expect(r.caret).toBe(3);
    expect(r.autoRef).toEqual({ start: 1, end: 3 });
  });

  it('does NOT replace when the caret has moved off the previous reference', () => {
    // autoRef was {1,3} but the user typed "+" so caret is at 4 now → append B2.
    const r = insertReference(
      { text: '=A1+', selStart: 4, selEnd: 4, autoRef: { start: 1, end: 3 } },
      'B2',
    );
    expect(r.text).toBe('=A1+B2');
    expect(r.caret).toBe(6);
  });

  it('does NOT replace when a range grows in place (same start): extends instead', () => {
    // Dragging updates the same anchor; component passes autoRef of the last
    // insert. A range ref starting at the same anchor should still replace the
    // stale single ref so drag-preview commits cleanly.
    const r = insertReference(
      { text: '=A1', selStart: 3, selEnd: 3, autoRef: { start: 1, end: 3 } },
      'A1:B2',
    );
    expect(r.text).toBe('=A1:B2');
    expect(r.caret).toBe(6);
    expect(r.autoRef).toEqual({ start: 1, end: 6 });
  });
});
