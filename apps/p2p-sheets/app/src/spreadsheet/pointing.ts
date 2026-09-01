/**
 * Grid-interaction router — the single decision point for "what does this
 * click/drag mean?".
 *
 * The bug this fixes: while editing a formula, a click on a cell must become a
 * reference to INSERT, not a selection to move. Keeping that decision here (a
 * pure function) makes it testable and keeps the event handlers dumb.
 */
import { cellRef, rangeRef, columnRef, rowRef, type CellCoord } from './refs';

export type PointTarget =
  | { kind: 'cell'; a: CellCoord; b?: CellCoord }
  | { kind: 'column'; col: number }
  | { kind: 'row'; row: number };

export interface PointInput {
  /** True while a formula is being edited — clicks build references. */
  pointMode: boolean;
  target: PointTarget;
}

export type PointAction =
  | { action: 'select-cell'; row: number; col: number }
  | { action: 'select-range'; a: CellCoord; b: CellCoord }
  | { action: 'select-column'; col: number }
  | { action: 'select-row'; row: number }
  | { action: 'insert-ref'; ref: string };

export function resolvePoint({ pointMode, target }: PointInput): PointAction {
  if (pointMode) {
    return { action: 'insert-ref', ref: refForTarget(target) };
  }
  switch (target.kind) {
    case 'cell':
      return target.b
        ? { action: 'select-range', a: target.a, b: target.b }
        : { action: 'select-cell', row: target.a.row, col: target.a.col };
    case 'column':
      return { action: 'select-column', col: target.col };
    case 'row':
      return { action: 'select-row', row: target.row };
  }
}

function refForTarget(target: PointTarget): string {
  switch (target.kind) {
    case 'cell':
      return target.b ? rangeRef(target.a, target.b) : cellRef(target.a.row, target.a.col);
    case 'column':
      return columnRef(target.col);
    case 'row':
      return rowRef(target.row);
  }
}
