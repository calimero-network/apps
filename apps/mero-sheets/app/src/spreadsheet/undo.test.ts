import { describe, expect, it } from 'vitest';
import { applicable, invert, pushBounded, UNDO_LIMIT, type CellChange, type UndoEntry } from './undo';

const st = (raw_value: string, format = '') => ({ raw_value, format });
const change = (row: string, before: string, after: string): CellChange =>
  ({ row_id: row, col_id: '0', before: st(before), after: st(after) });

describe('invert', () => {
  it('swaps before and after for cell edits', () => {
    const e: UndoEntry = { kind: 'cells', sheetId: 's', changes: [change('0', 'a', 'b')] };
    const inv = invert(e);
    expect(inv.kind === 'cells' && inv.changes[0]).toMatchObject({ before: st('b'), after: st('a') });
  });

  it('turns an insert into a delete and back', () => {
    const e: UndoEntry = { kind: 'axis', sheetId: 's', axis: 'row', ids: ['nab'], inserted: true };
    expect(invert(e)).toMatchObject({ inserted: false });
    expect(invert(invert(e))).toEqual(e);
  });
});

describe('applicable', () => {
  it('reverts only cells that still hold what this user wrote', () => {
    const changes = [change('0', 'a', 'b'), change('1', 'x', 'y')];
    // Someone else has since changed row 1.
    const current = (row: string) => (row === '0' ? st('b') : st('z'));
    expect(applicable(changes, current).map((c) => c.row_id)).toEqual(['0']);
  });

  it('drops no-op changes', () => {
    expect(applicable([change('0', 'a', 'a')], () => st('a'))).toEqual([]);
  });

  it('compares formats as well as values', () => {
    const c: CellChange = { row_id: '0', col_id: '0', before: st('1'), after: st('1', 'currency') };
    expect(applicable([c], () => st('1', 'currency'))).toHaveLength(1);
    expect(applicable([c], () => st('1', 'percent'))).toHaveLength(0);
  });
});

describe('pushBounded', () => {
  it('keeps the newest steps up to the limit', () => {
    let stack: UndoEntry[] = [];
    for (let i = 0; i < UNDO_LIMIT + 5; i++) {
      stack = pushBounded(stack, { kind: 'cells', sheetId: String(i), changes: [] });
    }
    expect(stack).toHaveLength(UNDO_LIMIT);
    expect(stack[0].sheetId).toBe('5');
  });
});
