/**
 * Per-author undo.
 *
 * Each person undoes only their own edits: the stack lives in this browser
 * and records what this user's writes changed. Undo writes the old state back
 * cell by cell, but only where a cell still holds what this user wrote — if a
 * collaborator has changed it since, undo leaves their edit alone rather than
 * silently reverting someone else's work.
 *
 * Structural edits undo too: an inserted row is deleted, a deleted row is
 * restored (the contract's row entries are last-writer-wins, so a restore
 * brings the row and its cells back exactly).
 */

/** What undo compares and restores: a cell's raw value (stored form) and format. */
export interface CellState {
  raw_value: string;
  format: string;
}

export interface CellChange {
  row_id: string;
  col_id: string;
  before: CellState;
  after: CellState;
}

export type UndoEntry =
  | { kind: 'cells'; sheetId: string; changes: CellChange[] }
  /** `inserted`: these ids were inserted (undo deletes); otherwise deleted (undo restores). */
  | { kind: 'axis'; sheetId: string; axis: 'row' | 'col'; ids: string[]; inserted: boolean };

/** How many steps are kept. */
export const UNDO_LIMIT = 100;

const same = (a: CellState, b: CellState) => a.raw_value === b.raw_value && a.format === b.format;

/** The entry that undoes `entry` (and, applied, redoes it). */
export function invert(entry: UndoEntry): UndoEntry {
  if (entry.kind === 'axis') return { ...entry, inserted: !entry.inserted };
  return {
    ...entry,
    changes: entry.changes.map((c) => ({ ...c, before: c.after, after: c.before })),
  };
}

/**
 * The changes undo may apply: those whose cell still holds what this user
 * wrote. Changes that were no-ops (before = after) are dropped too.
 */
export function applicable(
  changes: readonly CellChange[],
  current: (rowId: string, colId: string) => CellState,
): CellChange[] {
  return changes.filter((c) => !same(c.before, c.after) && same(current(c.row_id, c.col_id), c.after));
}

/** A bounded stack: push drops the oldest step past the limit. */
export function pushBounded(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const next = [...stack, entry];
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
}
