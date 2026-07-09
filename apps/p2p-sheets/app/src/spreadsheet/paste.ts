/**
 * Plan the cell writes for an in-app (full-fidelity) paste. Copy shifts each
 * formula's references by the paste offset (via shiftFormula, so $-anchors stay
 * fixed); cut moves formulas verbatim (a move keeps refs pointing where they
 * did). Pure — the caller performs the actual setCell/clearCell writes and
 * clips out-of-bounds targets.
 */
import { shiftFormula } from './shift';
import type { CellCoord, Rect } from './refs';

export interface ClipCell {
  dr: number; // row offset from the source top-left
  dc: number; // col offset from the source top-left
  raw: string;
  format: string;
}

export interface ClipPayload {
  cells: ClipCell[];
  rows: number;
  cols: number;
  cut: boolean;
  sourceRect: Rect;
  tsv: string; // the exact TSV written to the system clipboard (for self-detection)
}

export interface PasteWrite {
  row: number;
  col: number;
  raw: string;
  format: string;
}

export function planPaste(payload: ClipPayload, anchor: CellCoord): PasteWrite[] {
  // The whole block translates by (anchor - source top-left); every relative
  // ref in a copied formula shifts by that same delta.
  const dRow = anchor.row - payload.sourceRect.top;
  const dCol = anchor.col - payload.sourceRect.left;
  return payload.cells.map((c) => {
    const raw =
      !payload.cut && c.raw.startsWith('=') ? shiftFormula(c.raw, dRow, dCol) : c.raw;
    return { row: anchor.row + c.dr, col: anchor.col + c.dc, raw, format: c.format };
  });
}
