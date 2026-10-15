import { describe, expect, it } from 'vitest';
import { peopleRows } from './PeoplePanel';
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
