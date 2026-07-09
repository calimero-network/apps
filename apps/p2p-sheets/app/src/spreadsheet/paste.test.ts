import { describe, it, expect } from 'vitest';
import { planPaste, type ClipPayload } from './paste';

// Single-cell copy payload holding `raw` at source top-left (0,0).
function single(raw: string, cut = false): ClipPayload {
  return {
    cells: [{ dr: 0, dc: 0, raw, format: '' }],
    rows: 1, cols: 1, cut,
    sourceRect: { top: 0, left: 0, bottom: 0, right: 0 },
    sourceSheetId: 'src',
    tsv: '',
  };
}

describe('planPaste — copy', () => {
  it('shifts a relative formula by the anchor delta', () => {
    // copy =A1 from (0,0), paste anchored at (2,1) → shift by (+2,+1) → =B3
    const w = planPaste(single('=A1'), { row: 2, col: 1 });
    expect(w).toEqual([{ row: 2, col: 1, raw: '=B3', format: '' }]);
  });
  it('keeps $-anchored refs fixed', () => {
    const w = planPaste(single('=$A$1'), { row: 2, col: 1 });
    expect(w[0].raw).toBe('=$A$1');
  });
  it('preserves a cross-sheet qualifier while shifting the cell part', () => {
    const w = planPaste(single('=Sheet2!A1'), { row: 1, col: 0 });
    expect(w[0].raw).toBe('=Sheet2!A2');
  });
  it('writes a non-formula value verbatim', () => {
    const w = planPaste(single('42'), { row: 3, col: 3 });
    expect(w[0].raw).toBe('42');
  });
  it('places a multi-cell block by dr/dc and carries formats', () => {
    const payload: ClipPayload = {
      cells: [
        { dr: 0, dc: 0, raw: '=A1', format: 'currency' },
        { dr: 0, dc: 1, raw: 'x', format: '' },
        { dr: 1, dc: 0, raw: '5', format: '' },
      ],
      rows: 2, cols: 2, cut: false,
      sourceRect: { top: 0, left: 0, bottom: 1, right: 1 },
      sourceSheetId: 'src',
      tsv: '',
    };
    const w = planPaste(payload, { row: 10, col: 5 });
    expect(w).toEqual([
      { row: 10, col: 5, raw: '=F11', format: 'currency' }, // =A1 shifted by (+10,+5)
      { row: 10, col: 6, raw: 'x', format: '' },
      { row: 11, col: 5, raw: '5', format: '' },
    ]);
  });
});

describe('planPaste — cut', () => {
  it('moves a formula verbatim (no ref shift)', () => {
    const w = planPaste(single('=A1', true), { row: 4, col: 4 });
    expect(w[0].raw).toBe('=A1');
    expect(w[0].row).toBe(4);
    expect(w[0].col).toBe(4);
  });
});

describe('planPaste — cross-sheet copy', () => {
  it('qualifies formula refs to the source sheet instead of shifting', () => {
    // The reported bug: copying =SUM(A9:F9) to another sheet used to shift
    // refs off-grid into =SUM(#REF!:C9). It must now point back at the source.
    const w = planPaste(single('=SUM(A9:F9)'), { row: 4, col: 2 }, { sourceSheetName: 'Sheet1' });
    expect(w[0].raw).toBe('=SUM(Sheet1!A9:F9)');
  });
  it('still positions the cell by anchor + dr/dc', () => {
    const w = planPaste(single('=A1'), { row: 4, col: 2 }, { sourceSheetName: 'Sheet1' });
    expect(w[0]).toEqual({ row: 4, col: 2, raw: '=Sheet1!A1', format: '' });
  });
  it('pastes verbatim (never #REF!) when the source sheet name is unknown', () => {
    const w = planPaste(single('=SUM(A9:F9)'), { row: 4, col: 2 }, { sourceSheetName: null });
    expect(w[0].raw).toBe('=SUM(A9:F9)');
  });
  it('leaves a cut untouched even across sheets (move keeps refs verbatim)', () => {
    const w = planPaste(single('=A1', true), { row: 4, col: 2 }, { sourceSheetName: 'Sheet1' });
    expect(w[0].raw).toBe('=A1');
  });
});
