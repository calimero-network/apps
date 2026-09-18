import { describe, expect, it } from 'vitest';
import type { Cursor } from '../api/spreadsheet/SpreadsheetClient';
import { labelsById, labelMembers } from '../lib/people';
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

/** The roster as it comes back from `get_members`, indexed the way the UI uses it. */
const roster = (
  entries: { id: string; nickname: string }[],
  selfId: string | null,
) => labelsById(labelMembers(entries, selfId));

describe('avatarLabel', () => {
  it('derives a badge from a NAME, not from a hex key', () => {
    expect(avatarLabel('Ada Lovelace')).toBe('AL');
    expect(avatarLabel('ada')).toBe('AD');
  });

  it('never renders empty', () => {
    expect(avatarLabel('')).toBe('??');
  });
});

describe('distinctCollaborators', () => {
  const ME = 'a'.repeat(64);
  const BOB = 'b'.repeat(64);

  it('labels a cursor with the name its author chose', () => {
    // The point of the whole change: the roster and the cursors are keyed by the
    // same id, so "who moved that cell" has an answer a person can read.
    const result = distinctCollaborators(
      [cur(BOB, '#f00'), cur(ME, '#0f0')],
      ME,
      'SELF',
      roster(
        [
          { id: ME, nickname: 'Ada' },
          { id: BOB, nickname: 'Bob' },
        ],
        ME,
      ),
    );
    expect(result).toEqual([
      { author: ME, color: 'SELF', name: 'Ada', label: 'AD', anonymous: false, isSelf: true },
      { author: BOB, color: '#f00', name: 'Bob', label: 'BO', anonymous: false, isSelf: false },
    ]);
  });

  it('includes a roster member who has no live cursor', () => {
    // "In this spreadsheet" and "has a cursor somewhere right now" are different
    // questions from different sources. Someone reading is still here.
    const result = distinctCollaborators(
      [],
      ME,
      'SELF',
      roster(
        [
          { id: ME, nickname: 'Ada' },
          { id: BOB, nickname: 'Bob' },
        ],
        ME,
      ),
    );
    expect(result.map((c) => c.name)).toEqual(['Ada', 'Bob']);
  });

  it('shows a FLAGGED short id for an author with no name yet', () => {
    // Real state: someone is in the context from the moment they join, which is
    // before they have opened it and named themselves.
    const result = distinctCollaborators([cur(BOB, '#f00')], ME, 'SELF');
    const bob = result.find((c) => c.author === BOB)!;
    expect(bob.name).toBe('bbbbbbbb…');
    expect(bob.anonymous).toBe(true);
  });

  it('always includes the local user, even with no cursor and no roster row', () => {
    // Navigating away removes your cursor, and you have not necessarily named
    // yourself yet — you are still a collaborator in your own spreadsheet.
    const result = distinctCollaborators([cur(BOB, '#f00')], ME, 'SELF');
    expect(result[0]).toMatchObject({ author: ME, color: 'SELF', isSelf: true });
  });

  it('dedupes by author and keeps the cursor colour for peers', () => {
    const result = distinctCollaborators(
      [cur(BOB, '#f00'), cur(BOB, '#f00')],
      ME,
      'SELF',
      roster([{ id: BOB, nickname: 'Bob' }], ME),
    );
    expect(result.filter((c) => c.author === BOB)).toHaveLength(1);
    expect(result.find((c) => c.author === BOB)!.color).toBe('#f00');
  });

  it('orders named collaborators ahead of unnamed ones', () => {
    const result = distinctCollaborators(
      [cur(BOB, '#f00'), cur('c'.repeat(64), '#00f')],
      null,
      'SELF',
      roster([{ id: BOB, nickname: 'Bob' }], null),
    );
    expect(result.map((c) => c.anonymous)).toEqual([false, true]);
  });

  it('synthesises no self entry when the self key is null', () => {
    const result = distinctCollaborators([cur(BOB, '#f00')], null, 'SELF');
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe(BOB);
  });

  it('never emits an empty colour, which would render an invisible avatar', () => {
    const result = distinctCollaborators(
      [],
      null,
      'SELF',
      roster([{ id: BOB, nickname: 'Bob' }], null),
    );
    expect(result[0].color).not.toBe('');
  });
});

describe('peerCount', () => {
  it('counts distinct authors excluding self', () => {
    const cursors = [
      cur('me', '#0f0'),
      cur('bob', '#f00'),
      cur('amy', '#00f'),
      cur('bob', '#f00'),
    ];
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
