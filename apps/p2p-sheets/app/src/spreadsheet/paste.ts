/**
 * Plan the cell writes for an in-app (full-fidelity) paste. Copy shifts each
 * formula's references by the paste offset (via shiftFormula, so $-anchors stay
 * fixed); cut moves formulas verbatim (a move keeps refs pointing where they
 * did). Pure — the caller performs the actual setCell/clearCell writes and
 * clips out-of-bounds targets.
 */
import { shiftFormula, qualifyFormula } from './shift';
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
  sourceSheetId: string; // the sheet the copy came from — drives cross-sheet qualifying
  tsv: string; // the exact TSV written to the system clipboard (for self-detection)
}

export interface PasteWrite {
  row: number;
  col: number;
  raw: string;
  format: string;
}

export function planPaste(
  payload: ClipPayload,
  anchor: CellCoord,
  // When a copy crosses sheets, formulas are QUALIFIED to the source sheet
  // (`=SUM(A9:F9)` → `=SUM([sheet-1-aa]!A9:F9)`) rather than shifted — the
  // positional delta between two sheets is meaningless and would corrupt refs
  // into #REF!. `sourceSheetId: null` means cross-sheet but the source id is
  // unknown (e.g. sheet deleted): paste verbatim, never #REF. Omit/null for
  // same-sheet.
  crossSheet?: { sourceSheetId: string | null } | null,
): PasteWrite[] {
  // Same-sheet: the whole block translates by (anchor - source top-left); every
  // relative ref in a copied formula shifts by that same delta.
  const dRow = anchor.row - payload.sourceRect.top;
  const dCol = anchor.col - payload.sourceRect.left;
  return payload.cells.map((c) => {
    let raw = c.raw;
    if (!payload.cut && c.raw.startsWith('=')) {
      if (crossSheet) {
        raw =
          crossSheet.sourceSheetId != null
            ? qualifyFormula(c.raw, crossSheet.sourceSheetId)
            : c.raw; // cross-sheet, source id unknown → verbatim (never #REF!)
      } else {
        raw = shiftFormula(c.raw, dRow, dCol);
      }
    }
    return { row: anchor.row + c.dr, col: anchor.col + c.dc, raw, format: c.format };
  });
}
