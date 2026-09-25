import { describe, expect, it } from 'vitest';
import type { Protection } from '../api/spreadsheet/SpreadsheetClient';
import { canComment, canEdit, lockedReason, placeProtections } from './access';

const prot = (over: Partial<Protection>): Protection => ({
  id: 'p', sheet_id: 's', top_row_id: '1', left_col_id: '0', bottom_row_id: '2', right_col_id: '1',
  description: 'Totals', editors: [], created_by: 'o', ...over,
});
// Legacy ids are positions.
const locate = (r: string, c: string) => (r === 'gone' ? null : { row: Number(r), col: Number(c) });

describe('roles', () => {
  it('lets owners and editors edit, and commenters comment', () => {
    expect([canEdit('owner'), canEdit('editor'), canEdit('commenter'), canEdit('viewer')]).toEqual([true, true, false, false]);
    expect([canComment('commenter'), canComment('viewer')]).toEqual([true, false]);
  });
});

describe('placeProtections', () => {
  it('places a range by its corners on this sheet only', () => {
    const placed = placeProtections([prot({}), prot({ id: 'q', sheet_id: 'other' })], 's', locate, 'me', 'editor');
    expect(placed).toEqual([{ id: 'p', rect: { top: 1, left: 0, bottom: 2, right: 1 }, allowed: false, description: 'Totals', wholeSheet: false }]);
  });

  it('allows owners and listed editors', () => {
    expect(placeProtections([prot({})], 's', locate, 'me', 'owner')[0].allowed).toBe(true);
    expect(placeProtections([prot({ editors: ['me'] })], 's', locate, 'me', 'editor')[0].allowed).toBe(true);
  });

  it('drops a range whose corner is gone, and covers the sheet when it has no corners', () => {
    expect(placeProtections([prot({ top_row_id: 'gone' })], 's', locate, 'me', 'editor')).toEqual([]);
    const whole = placeProtections([prot({ top_row_id: '', left_col_id: '', bottom_row_id: '', right_col_id: '' })], 's', locate, 'me', 'editor');
    expect(whole[0].wholeSheet).toBe(true);
    expect(lockedReason(whole, 'editor', 999, 700)).toBe('Protected: Totals');
  });
});

describe('lockedReason', () => {
  const placed = placeProtections([prot({})], 's', locate, 'me', 'editor');
  it('names the protection over a locked cell, and nothing outside it', () => {
    expect(lockedReason(placed, 'editor', 2, 1)).toBe('Protected: Totals');
    expect(lockedReason(placed, 'editor', 3, 1)).toBeNull();
  });
  it('locks every cell for a viewer or commenter', () => {
    expect(lockedReason([], 'viewer', 0, 0)).toMatch(/viewer/);
    expect(lockedReason([], 'commenter', 0, 0)).toMatch(/commenter/);
  });
});
