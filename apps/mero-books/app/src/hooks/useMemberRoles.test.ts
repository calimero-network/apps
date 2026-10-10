/**
 * `effectiveFor` is the function the members table calls for every row, and it
 * is the join between three maps that each mean something different. Pure, so
 * it is tested directly rather than through a rendered table.
 */
import { describe, expect, it, vi } from 'vitest';
import { effectiveFor, readDefaultCapabilities, type DefaultCapabilitiesAdmin } from './useMemberRoles';
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

describe('readDefaultCapabilities', () => {
  function fakeAdmin(opts: { wrapper?: unknown; wrapperError?: unknown; info?: unknown; infoError?: unknown }) {
    const getDefaultCapabilities = vi.fn(async () => {
      if (opts.wrapperError) throw opts.wrapperError;
      return opts.wrapper as never;
    });
    const getGroupInfo = vi.fn(async () => {
      if (opts.infoError) throw opts.infoError;
      return opts.info as never;
    });
    return {
      admin: { getDefaultCapabilities, getGroupInfo } as unknown as DefaultCapabilitiesAdmin,
      getDefaultCapabilities,
      getGroupInfo,
    };
  }

  it('answers from the thin wrapper when it works, without a second read', async () => {
    const { admin, getGroupInfo } = fakeAdmin({ wrapper: MEMBER_CAPABILITIES });
    expect(await readDefaultCapabilities(admin, 'ns')).toBe(MEMBER_CAPABILITIES);
    expect(getGroupInfo).not.toHaveBeenCalled();
  });

  it('falls back to the group info record when the wrapper is refused', async () => {
    // An account reading through the relay: the wrapper 403s, the record it
    // reads from does not. Members of the workspace must not read as 0.
    const { admin } = fakeAdmin({
      wrapperError: Object.assign(new Error('forbidden'), { status: 403 }),
      info: { groupId: 'ns', defaultCapabilities: MEMBER_CAPABILITIES },
    });
    expect(await readDefaultCapabilities(admin, 'ns')).toBe(MEMBER_CAPABILITIES);
  });

  it('keeps 0 as a real answer', async () => {
    const { admin } = fakeAdmin({ wrapper: 0 });
    expect(await readDefaultCapabilities(admin, 'ns')).toBe(0);
  });

  it('is null - unknown, not 0 - when neither read answers', async () => {
    const { admin } = fakeAdmin({ wrapperError: new Error('x'), infoError: new Error('y') });
    expect(await readDefaultCapabilities(admin, 'ns')).toBeNull();
  });
});
