import { describe, expect, it } from 'vitest';
import { peopleRows, rowName } from './PeoplePanel';
import type { Member } from '../hooks/useSpreadsheet';

const member = (id: string, account: string) => ({ id, account, role: 'editor', nickname: '' }) as unknown as Member;

describe('peopleRows', () => {
  // A TEE node is in the workspace group but is not a person: it used to show
  // as someone who "hasn't opened this workbook", with a Remove button for
  // admins. It belongs only to the always-on section.
  it('lists people only, and counts the TEE nodes apart', () => {
    const group = [
      { identity: 'acc-ann', role: 'Admin' },
      { identity: 'acc-bob', role: 'Member' },
      { identity: 'tee-relay', role: 'RelayTee' },
      { identity: 'tee-replica', role: 'ReadOnlyTee' },
    ];
    const { rows, tees } = peopleRows([member('m-ann', 'acc-ann'), member('m-tee', 'tee-relay')], group);
    expect(rows.map((r) => r.key)).toEqual(['m-ann', 'acc-bob']);
    expect(rows[0].person?.identity).toBe('acc-ann');
    expect(tees).toBe(2);
  });

  it('counts no TEE when none is admitted', () => {
    const { rows, tees } = peopleRows([], [{ identity: 'acc-bob', role: 'Member' }]);
    expect(rows.map((r) => r.key)).toEqual(['acc-bob']);
    expect(tees).toBe(0);
  });
});

// A workspace member who has not opened this workbook used to be listed as
// `5926f2d2…` even when they had a workspace name.
describe('rowName', () => {
  const names: Record<string, string> = { 'acc-bob': 'Bob', 'm-ann': 'Ann' };
  const nameOf = (id: string) => names[id] ?? `${id}?`;

  it('names a group person who has not opened the workbook by their account', () => {
    const { rows } = peopleRows([], [{ identity: 'acc-bob', role: 'Member' }]);
    expect(rowName(rows[0], nameOf)).toBe('Bob');
  });

  it('names a workbook member by their member id', () => {
    const { rows } = peopleRows([member('m-ann', 'acc-ann')], [{ identity: 'acc-ann', role: 'Admin' }]);
    expect(rowName(rows[0], nameOf)).toBe('Ann');
  });
});
