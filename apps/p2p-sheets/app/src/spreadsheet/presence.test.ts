import { describe, expect, it } from 'vitest';
import type { Cursor } from '../api/spreadsheet/SpreadsheetClient';
import {
  avatarLabel,
  distinctCollaborators,
  peerCount,
  syncLabel,
  peersLabel,
  cellsLabel,
} from './presence';

const cur = (author: string, color: string): Cursor => ({
  id: `${author}-1`,
  author,
  sheet_id: 's1',
  row: 0,
  col: 0,
  color,
  updated_at: 0,
});

describe('avatarLabel', () => {
  it('takes the first two chars, uppercased', () => {
    expect(avatarLabel('abcdef')).toBe('AB');
  });
  it('handles a one-char author', () => {
    expect(avatarLabel('x')).toBe('X');
  });
  it('handles an empty author', () => {
    expect(avatarLabel('')).toBe('?');
  });
});

describe('distinctCollaborators', () => {
  it('dedupes by author and marks/sorts self first', () => {
    const cursors = [cur('bob', '#f00'), cur('me', '#0f0'), cur('bob', '#f00')];
    const result = distinctCollaborators(cursors, 'me');
    expect(result).toEqual([
      { author: 'me', color: '#0f0', label: 'ME', isSelf: true },
      { author: 'bob', color: '#f00', label: 'BO', isSelf: false },
    ]);
  });
  it('returns only peers when self is not present in cursors', () => {
    const result = distinctCollaborators([cur('bob', '#f00')], 'me');
    expect(result).toEqual([
      { author: 'bob', color: '#f00', label: 'BO', isSelf: false },
    ]);
  });
});

describe('peerCount', () => {
  it('counts distinct authors excluding self', () => {
    const cursors = [cur('me', '#0f0'), cur('bob', '#f00'), cur('amy', '#00f'), cur('bob', '#f00')];
    expect(peerCount(cursors, 'me')).toBe(2);
  });
  it('is zero when only self is present', () => {
    expect(peerCount([cur('me', '#0f0')], 'me')).toBe(0);
  });
});

describe('status labels', () => {
  it('syncLabel', () => {
    expect(syncLabel(true)).toBe('Synced');
    expect(syncLabel(false)).toBe('Syncing…');
  });
  it('peersLabel singular/plural', () => {
    expect(peersLabel(0)).toBe('0 peers');
    expect(peersLabel(1)).toBe('1 peer');
    expect(peersLabel(3)).toBe('3 peers');
  });
  it('cellsLabel singular/plural', () => {
    expect(cellsLabel(1)).toBe('1 cell');
    expect(cellsLabel(12)).toBe('12 cells');
  });
});
