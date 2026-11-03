/**
 * `effectiveFor` is the function the members table calls for every row, and it
 * is the join between three maps that each mean something different. Pure, so
 * it is tested directly rather than through a rendered table.
 */
import { describe, expect, it } from 'vitest';
import { effectiveFor } from './useMemberRoles';
import { ALL_CAPABILITIES, CAP, MEMBER_CAPABILITIES } from '../utils/roles';

const ADMIN = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const PINNED = 'c'.repeat(64);
const STRANGER = 'd'.repeat(64);

const state = {
  roles: new Map([
    [ADMIN, 'Admin'],
    [MEMBER, 'Member'],
    [PINNED, 'Member'],
  ]),
  // 0 is what core reports for a member with NO override set.
  overrides: new Map([
    [ADMIN, 0],
    [MEMBER, 0],
    [PINNED, CAP.CAN_CREATE_CONTEXT],
  ]),
  defaultCapabilities: MEMBER_CAPABILITIES,
};

describe('effectiveFor', () => {
  it('reports everything for an admin whose override is 0', () => {
    expect(effectiveFor(ADMIN, state)).toBe(ALL_CAPABILITIES);
  });

  it('falls a member with no override back to the workspace default', () => {
    expect(effectiveFor(MEMBER, state)).toBe(MEMBER_CAPABILITIES);
  });

  it('honours a per-member override in place of the default', () => {
    expect(effectiveFor(PINNED, state)).toBe(CAP.CAN_CREATE_CONTEXT);
  });

  it('gives an account absent from every map the workspace default', () => {
    // A row can exist before the capability read lands. Falling back to the
    // default (rather than to 0) keeps the table from briefly claiming a member
    // can do nothing, which reads as a permissions bug that is not there.
    expect(effectiveFor(STRANGER, state)).toBe(MEMBER_CAPABILITIES);
  });

  it('reports nothing when the default has not been read yet', () => {
    expect(
      effectiveFor(MEMBER, { ...state, defaultCapabilities: null }),
    ).toBe(0);
  });
});
