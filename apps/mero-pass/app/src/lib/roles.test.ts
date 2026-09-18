import { describe, expect, it } from 'vitest';
import { CAPABILITIES, hasCap } from '@calimero-network/mero-js';

import {
  ADMIN_CAPABILITIES,
  MEMBER_CAPABILITIES,
  canCreateVault,
  canEnterVaults,
  canInvite,
  canManageMembers,
  capabilitiesForRole,
  missingForRole,
  normaliseRole,
  roleLabel,
  satisfiesRole,
} from './roles';

describe('the capability sets each role is defined as', () => {
  it('gives a Member exactly the bit needed to open vaults, and nothing else', () => {
    // The point of the role system: a Member is invited to USE the vaults, not
    // to govern the space.
    expect(MEMBER_CAPABILITIES).toBe(CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS);
    expect(canEnterVaults(MEMBER_CAPABILITIES)).toBe(true);
    expect(canCreateVault(MEMBER_CAPABILITIES)).toBe(false);
    expect(canInvite(MEMBER_CAPABILITIES)).toBe(false);
    expect(canManageMembers(MEMBER_CAPABILITIES)).toBe(false);
  });

  it('is a REDUCTION on the 15 this app shipped with', () => {
    // 15 = CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS | CAN_JOIN_OPEN_SUBGROUPS |
    // MANAGE_MEMBERS. Ported from mero-stream, it made everyone invited to a
    // space able to invite further people and to demote the person who made it
    // — so there was no role system, only the appearance of one.
    const OLD_DEFAULT = 15;
    expect(canManageMembers(OLD_DEFAULT)).toBe(true);
    expect(canInvite(OLD_DEFAULT)).toBe(true);
    expect(canManageMembers(MEMBER_CAPABILITIES)).toBe(false);
    expect(canInvite(MEMBER_CAPABILITIES)).toBe(false);
  });

  it('gives an Admin every bit the app actually calls, and a Member is a subset', () => {
    // Derived from the call sites, not chosen: createVault needs
    // CAN_CREATE_SUBGROUP + CAN_MANAGE_METADATA + CAN_MANAGE_VISIBILITY +
    // CAN_CREATE_CONTEXT; minting needs CAN_INVITE_MEMBERS; role changes need
    // MANAGE_MEMBERS; entering a vault needs CAN_JOIN_OPEN_SUBGROUPS.
    for (const bit of [
      CAPABILITIES.CAN_CREATE_SUBGROUP,
      CAPABILITIES.CAN_MANAGE_METADATA,
      CAPABILITIES.CAN_MANAGE_VISIBILITY,
      CAPABILITIES.CAN_CREATE_CONTEXT,
      CAPABILITIES.CAN_INVITE_MEMBERS,
      CAPABILITIES.MANAGE_MEMBERS,
      CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS,
    ]) {
      expect(hasCap(ADMIN_CAPABILITIES, bit)).toBe(true);
    }
    // An Admin can do everything a Member can.
    expect(ADMIN_CAPABILITIES & MEMBER_CAPABILITIES).toBe(MEMBER_CAPABILITIES);
  });

  it('withholds the capabilities nothing in this app uses', () => {
    // A password manager must not hand out a bit it has no call site for —
    // least of all CAN_AUTHOR_ON_BEHALF, which lets a node publish writes
    // attributed to another person.
    expect(hasCap(ADMIN_CAPABILITIES, CAPABILITIES.CAN_AUTHOR_ON_BEHALF)).toBe(
      false,
    );
    expect(hasCap(ADMIN_CAPABILITIES, CAPABILITIES.MANAGE_APPLICATION)).toBe(
      false,
    );
    expect(hasCap(ADMIN_CAPABILITIES, CAPABILITIES.CAN_DELETE_SUBGROUP)).toBe(
      false,
    );
  });

  it('maps a role to its mask', () => {
    expect(capabilitiesForRole('admin')).toBe(ADMIN_CAPABILITIES);
    expect(capabilitiesForRole('member')).toBe(MEMBER_CAPABILITIES);
  });
});

describe('normaliseRole', () => {
  it('accepts every spelling core uses for an admin', () => {
    for (const raw of ['Admin', 'admin', 'ADMIN', ' Admin ']) {
      expect(normaliseRole(raw)).toBe('admin');
    }
  });

  it('treats the namespace OWNER as an admin', () => {
    // The creator of a space holds full capabilities independently of the
    // default, and must never render as a plain member of their own space.
    expect(normaliseRole('Owner')).toBe('admin');
    expect(normaliseRole('owner')).toBe('admin');
  });

  it('falls back to member for anything it does not recognise', () => {
    // The safe direction: the alternative is showing admin controls that 403.
    for (const raw of [
      'Member',
      'ReadOnly',
      'read-only',
      '',
      null,
      undefined,
    ]) {
      expect(normaliseRole(raw)).toBe('member');
    }
  });
});

describe('the gates are asked of the MASK, never of the role string', () => {
  it('reports no permission at all for an unreadable mask', () => {
    // null is "the node did not tell us", which must close every gate rather
    // than defaulting them open.
    expect(canCreateVault(null)).toBe(false);
    expect(canInvite(null)).toBe(false);
    expect(canManageMembers(null)).toBe(false);
    expect(canEnterVaults(null)).toBe(false);
  });

  it('refuses vault creation on a mask missing ANY of the four bits it needs', () => {
    // The failure this catches: a partly-projected grant that looks like an
    // admin but 403s halfway through createVault, leaving a subgroup with no
    // context behind it.
    const full = ADMIN_CAPABILITIES;
    expect(canCreateVault(full)).toBe(true);
    for (const bit of [
      CAPABILITIES.CAN_CREATE_SUBGROUP,
      CAPABILITIES.CAN_MANAGE_VISIBILITY,
      CAPABILITIES.CAN_CREATE_CONTEXT,
    ]) {
      expect(canCreateVault(full & ~bit)).toBe(false);
    }
  });
});

describe('missingForRole', () => {
  it('names the bits a promotion has not delivered yet', () => {
    // A grant is published as an op and projected a moment later, so a mask
    // read straight after a promotion can legitimately be short. Naming the
    // gap is the honest report; "failed" is not.
    const partial = ADMIN_CAPABILITIES & ~CAPABILITIES.MANAGE_MEMBERS;
    expect(missingForRole(partial, 'admin')).toEqual(['MANAGE_MEMBERS']);
    expect(satisfiesRole(partial, 'admin')).toBe(false);
  });

  it('is empty once the mask satisfies the role', () => {
    expect(missingForRole(ADMIN_CAPABILITIES, 'admin')).toEqual([]);
    expect(satisfiesRole(ADMIN_CAPABILITIES, 'admin')).toBe(true);
    expect(satisfiesRole(MEMBER_CAPABILITIES, 'member')).toBe(true);
  });

  it('counts an admin mask as satisfying the member role', () => {
    // A demotion that has not projected yet still satisfies "member", because
    // the member bits are a subset. The panel must not report a spurious gap.
    expect(satisfiesRole(ADMIN_CAPABILITIES, 'member')).toBe(true);
  });

  it('reports everything as missing for a null mask', () => {
    expect(missingForRole(null, 'member')).toEqual(['CAN_JOIN_OPEN_SUBGROUPS']);
  });
});

describe('roleLabel', () => {
  it('renders the spelling core serialises', () => {
    // Fed straight to `updateMemberRole`, whose enum accepts several spellings
    // but writes these.
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('member')).toBe('Member');
  });
});
