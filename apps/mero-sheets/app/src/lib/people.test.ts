import { describe, expect, it } from 'vitest';
import {
  initials,
  labelMembers,
  labelsById,
  memberLabel,
  shortId,
  summariseMembers,
} from './people';

const HEX_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const HEX_B = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';

describe('initials', () => {
  it('takes first + last word for a multi-word name', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Ada Byron King Lovelace')).toBe('AL');
  });

  it('takes the first two letters of a single word', () => {
    expect(initials('ada')).toBe('AD');
  });

  it('never renders empty — an avatar with no glyph reads as a bug', () => {
    expect(initials('')).toBe('??');
    expect(initials('   ')).toBe('??');
  });

  it('does not split a surrogate pair', () => {
    // `"👋x".slice(0, 2)` cuts the emoji in half and renders a replacement glyph.
    expect(initials('👋x')).toBe('👋X');
  });
});

describe('shortId', () => {
  it('truncates and marks the truncation', () => {
    expect(shortId(HEX_A)).toBe('a1b2c3d4…');
  });
});

describe('memberLabel', () => {
  it('uses the nickname the member chose', () => {
    expect(memberLabel({ id: HEX_A, nickname: 'Ada' }, null)).toEqual({
      memberId: HEX_A,
      label: 'Ada',
      anonymous: false,
      isSelf: false,
    });
  });

  it('falls back to a short id AND flags it as a placeholder', () => {
    // The flag is the point. A truncated key rendered in the same weight as a
    // real name is a worse lie than the full key was — the UI has to be able to
    // style it as the placeholder it is.
    const label = memberLabel({ id: HEX_A, nickname: '' }, null);
    expect(label.label).toBe('a1b2c3d4…');
    expect(label.anonymous).toBe(true);
  });

  it('treats a whitespace-only nickname as absent', () => {
    expect(memberLabel({ id: HEX_A, nickname: '   ' }, null).anonymous).toBe(true);
  });

  it('marks self only on an exact id match, never on a null self', () => {
    expect(memberLabel({ id: HEX_A, nickname: 'Ada' }, HEX_A).isSelf).toBe(true);
    expect(memberLabel({ id: HEX_A, nickname: 'Ada' }, HEX_B).isSelf).toBe(false);
    expect(memberLabel({ id: HEX_A, nickname: 'Ada' }, '').isSelf).toBe(false);
    expect(memberLabel({ id: HEX_A, nickname: 'Ada' }, null).isSelf).toBe(false);
  });
});

describe('labelMembers', () => {
  const roster = [
    { id: HEX_B, nickname: '' },
    { id: 'c'.repeat(64), nickname: 'Zoe' },
    { id: HEX_A, nickname: 'Ada' },
    { id: 'd'.repeat(64), nickname: 'Bob' },
  ];

  it('orders self first, then names, then placeholders', () => {
    const labels = labelMembers(roster, 'd'.repeat(64));
    expect(labels.map((l) => l.label)).toEqual([
      'Bob',
      'Ada',
      'Zoe',
      'ffeeddcc…',
    ]);
    expect(labels[0].isSelf).toBe(true);
    expect(labels[3].anonymous).toBe(true);
  });

  it('is a total order, so the list does not reshuffle between syncs', () => {
    const a = labelMembers(roster, null).map((l) => l.memberId);
    const b = labelMembers([...roster].reverse(), null).map((l) => l.memberId);
    expect(a).toEqual(b);
  });

  it('handles an empty roster', () => {
    expect(labelMembers([], HEX_A)).toEqual([]);
  });
});

describe('labelsById', () => {
  it('indexes on the id a cursor is authored by', () => {
    // `Member.id` and `Cursor.author` are both `hex(device_id)` on purpose, so a
    // cursor can be labelled with the name its author chose without translation.
    const index = labelsById(labelMembers([{ id: HEX_A, nickname: 'Ada' }], null));
    expect(index.get(HEX_A)?.label).toBe('Ada');
    expect(index.get(HEX_B)).toBeUndefined();
  });
});

describe('summariseMembers', () => {
  const labels = labelMembers(
    [
      { id: HEX_A, nickname: 'Ada' },
      { id: HEX_B, nickname: 'Bob' },
      { id: 'c'.repeat(64), nickname: 'Cy' },
      { id: 'd'.repeat(64), nickname: 'Dee' },
      { id: 'e'.repeat(64), nickname: 'Eve' },
    ],
    HEX_A,
  );

  it('says "You" for the local member', () => {
    expect(summariseMembers(labels, 2)).toBe('You, Bob +3');
  });

  it('counts the remainder rather than dropping it', () => {
    // "+3" is the difference between a truncated list and a wrong one.
    expect(summariseMembers(labels, 5)).toBe('You, Bob, Cy, Dee, Eve');
    expect(summariseMembers(labels, 1)).toBe('You +4');
  });

  it('is empty for an empty roster', () => {
    expect(summariseMembers([])).toBe('');
  });
});
