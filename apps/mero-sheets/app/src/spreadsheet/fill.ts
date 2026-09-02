/**
 * Compute the cells to write when a fill drags the source range down or right
 * into a larger target. Formula cells shift their refs (shiftFormula); an
 * all-numeric source line extends as a series (fillSeries); otherwise cells
 * copy verbatim. Each written cell carries its pattern source's format. Pure —
 * the caller performs the actual setCell/setCellFormat writes.
 */
import { shiftFormula } from './shift';
import { fillSeries } from './series';
import type { Rect } from './refs';

export interface SourceCell {
  raw: string;
  format: string;
}
export interface FillWrite {
  row: number;
  col: number;
  raw: string;
  format: string;
}

export function planFill(
  source: Rect,
  target: Rect,
  getCell: (row: number, col: number) => SourceCell | null,
): FillWrite[] {
  const cell = (r: number, c: number): SourceCell => getCell(r, c) ?? { raw: '', format: '' };
  const writes: FillWrite[] = [];
  const vertical = target.bottom > source.bottom;
  const horizontal = target.right > source.right;

  if (vertical) {
    for (let c = source.left; c <= source.right; c++) {
      const src: (SourceCell & { pos: number })[] = [];
      for (let r = source.top; r <= source.bottom; r++) src.push({ pos: r, ...cell(r, c) });
      const k = src.length;
      const targets: number[] = [];
      for (let r = source.bottom + 1; r <= target.bottom; r++) targets.push(r);
      const allFormula = src.every((s) => s.raw.startsWith('='));
      const series = allFormula ? [] : fillSeries(src.map((s) => s.raw), targets.length);
      targets.forEach((tr, j) => {
        const s = src[j % k];
        // A non-formula cell always has a series entry here (series is only
        // empty when every source cell is a formula, in which case this branch
        // is unreachable), so `series[j]` covers both the numeric-series and
        // cyclic-copy cases.
        const raw = s.raw.startsWith('=') ? shiftFormula(s.raw, tr - s.pos, 0) : series[j];
        writes.push({ row: tr, col: c, raw, format: s.format });
      });
    }
  } else if (horizontal) {
    for (let r = source.top; r <= source.bottom; r++) {
      const src: (SourceCell & { pos: number })[] = [];
      for (let c = source.left; c <= source.right; c++) src.push({ pos: c, ...cell(r, c) });
      const k = src.length;
      const targets: number[] = [];
      for (let c = source.right + 1; c <= target.right; c++) targets.push(c);
      const allFormula = src.every((s) => s.raw.startsWith('='));
      const series = allFormula ? [] : fillSeries(src.map((s) => s.raw), targets.length);
      targets.forEach((tc, j) => {
        const s = src[j % k];
        // See the vertical branch: a non-formula cell always has a series entry.
        const raw = s.raw.startsWith('=') ? shiftFormula(s.raw, 0, tc - s.pos) : series[j];
        writes.push({ row: r, col: tc, raw, format: s.format });
      });
    }
  }
  return writes;
}
