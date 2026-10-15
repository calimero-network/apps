/**
 * A TEE fleet node is admitted to the namespace as a `ReadOnlyTee` (replica) or
 * `RelayTee` (relay) member row. It used to show up on the Members page as a
 * nameless `cb62…4c3c` member with a role control, in the assignee
 * suggestions and in the sidebar's member/peer count. It is infrastructure, so `useWorkspace`
 * splits it out with `splitTeeMembers` before anything reads the roster.
 */
import { describe, expect, it } from 'vitest';
import { isTeeRole, splitTeeMembers, teeMode } from './tee';

const RONIT = { identity: 'a'.repeat(64), role: 'Admin', name: 'Ronit' };
const XABI = { identity: 'b'.repeat(64), role: 'Member', name: 'Xabi' };
const REPLICA = { identity: 'c'.repeat(64), role: 'ReadOnlyTee' };
const RELAY = { identity: 'd'.repeat(64), role: 'RelayTee' };

describe('isTeeRole', () => {
  it('matches only the two TEE roles', () => {
    expect(isTeeRole('ReadOnlyTee')).toBe(true);
    expect(isTeeRole('RelayTee')).toBe(true);
    expect(isTeeRole('ReadOnly')).toBe(false);
    expect(isTeeRole('Admin')).toBe(false);
    expect(isTeeRole(undefined)).toBe(false);
  });
});

describe('splitTeeMembers', () => {
  it('keeps TEE nodes out of the people list, and so out of every count', () => {
    const { people, tee } = splitTeeMembers([RONIT, REPLICA, XABI, RELAY]);

    expect(people.map((m) => m.identity)).toEqual([RONIT.identity, XABI.identity]);
    expect(people).toHaveLength(2);
    expect(tee.map((m) => m.identity)).toEqual([REPLICA.identity, RELAY.identity]);
  });

  it('leaves a roster without a TEE node untouched', () => {
    const { people, tee } = splitTeeMembers([RONIT, XABI]);

    expect(people).toEqual([RONIT, XABI]);
    expect(tee).toEqual([]);
  });
});

describe('teeMode', () => {
  it('is null when no TEE node is admitted', () => {
    expect(teeMode([])).toBeNull();
  });

  it('is Relay when any TEE node is a relay', () => {
    expect(teeMode([REPLICA, RELAY])).toBe('Relay');
  });

  it('is Replica when every TEE node is a read-only replica', () => {
    expect(teeMode([REPLICA])).toBe('Replica');
  });
});
