/**
 * Pins the role/capability model — specifically the three places where the
 * obvious reading is wrong, each of which produces a promotion that grants
 * nothing (or a demotion that takes nothing away):
 *
 *   1. `Admin` BYPASSES the capability bitmask, so an admin whose override is 0
 *      can do everything, not nothing.
 *   2. For a Member, override `0` means "no override — inherit the group
 *      default", not "no permissions".
 *   3. A non-zero override REPLACES the default; it is not OR'd with it.
 *
 * The behaviour is pinned against live nodes by
 * `apps/mero-drive/logic/workflows/probes/workflow-mero-drive-members.yml`
 * (role round-trip leaves the override untouched; bitmasks stored verbatim).
 * These tests pin this app's reading of it.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_CAPABILITIES,
  CAP,
  MEMBER_CAPABILITIES,
  ROLE_ADMIN,
  ROLE_MEMBER,
  canCreateRepo,
  canInvite,
  canManageMembers,
  defaultIsUsable,
  describeCapabilities,
  effectiveCapabilities,
  hasCapability,
  isAdminRole,
  normaliseRole,
  repairedDefault,
  toggledRole,
  withCapability,
} from './roles';

describe('role spelling', () => {
  it('recognises an admin whatever case the node or another app wrote', () => {
    for (const spelling of ['Admin', 'admin', 'ADMIN', '  Admin  ']) {
      expect(isAdminRole(spelling)).toBe(true);
      expect(normaliseRole(spelling)).toBe(ROLE_ADMIN);
    }
  });

  it('treats everything else, including absent, as an ordinary member', () => {
    for (const spelling of ['Member', 'member', '', null, undefined, 'owner']) {
      expect(isAdminRole(spelling)).toBe(false);
      expect(normaliseRole(spelling)).toBe(ROLE_MEMBER);
    }
  });

  it('toggles between exactly the two roles this app offers', () => {
    expect(toggledRole('Member')).toBe(ROLE_ADMIN);
    expect(toggledRole('Admin')).toBe(ROLE_MEMBER);
    expect(toggledRole(null)).toBe(ROLE_ADMIN);
  });
});

describe('effectiveCapabilities', () => {
  it('gives an Admin everything, even with a zero override and a zero default', () => {
    // The trap this whole module exists for: reading the override alone would
    // report that a freshly promoted admin can do nothing.
    expect(effectiveCapabilities({ role: 'Admin', override: 0, groupDefault: 0 })).toBe(
      ALL_CAPABILITIES,
    );
  });

  it('gives an Admin everything even when their override is NARROW', () => {
    // A leftover override from before the promotion must not cap an admin.
    expect(
      effectiveCapabilities({ role: 'Admin', override: CAP.CAN_CREATE_CONTEXT, groupDefault: 0 }),
    ).toBe(ALL_CAPABILITIES);
  });

  it('falls a Member back to the group default when the override is 0', () => {
    expect(
      effectiveCapabilities({ role: 'Member', override: 0, groupDefault: MEMBER_CAPABILITIES }),
    ).toBe(MEMBER_CAPABILITIES);
  });

  it('treats a missing override exactly like 0', () => {
    expect(
      effectiveCapabilities({ role: 'Member', groupDefault: MEMBER_CAPABILITIES }),
    ).toBe(MEMBER_CAPABILITIES);
    expect(
      effectiveCapabilities({ role: 'Member', override: null, groupDefault: 7 }),
    ).toBe(7);
  });

  it('lets a non-zero override REPLACE the default, not widen it', () => {
    // Not `override | default`: core stores the override verbatim and it is the
    // whole answer. OR-ing would make it impossible to take a bit away.
    expect(
      effectiveCapabilities({
        role: 'Member',
        override: CAP.CAN_CREATE_CONTEXT,
        groupDefault: MEMBER_CAPABILITIES,
      }),
    ).toBe(CAP.CAN_CREATE_CONTEXT);
  });

  it('is nothing for a Member with no override and no default', () => {
    expect(effectiveCapabilities({ role: 'Member', override: 0, groupDefault: 0 })).toBe(0);
    expect(effectiveCapabilities({ role: 'Member' })).toBe(0);
  });

  it('includes every bit the SDK assigns, so a new core bit is not dropped', () => {
    for (const bit of Object.values(CAP)) {
      expect(hasCapability(ALL_CAPABILITIES, bit)).toBe(true);
    }
  });
});

describe('the three questions this app asks', () => {
  const admin = { role: ROLE_ADMIN, override: 0, groupDefault: 0 };
  const plainMember = { role: ROLE_MEMBER, override: 0, groupDefault: MEMBER_CAPABILITIES };
  const strandedMember = { role: ROLE_MEMBER, override: 0, groupDefault: 0 };

  it('an admin may do all three', () => {
    expect(canManageMembers(admin)).toBe(true);
    expect(canCreateRepo(admin)).toBe(true);
    expect(canInvite(admin)).toBe(true);
  });

  it('a member on this app’s default may work but not manage members', () => {
    expect(canCreateRepo(plainMember)).toBe(true);
    expect(canInvite(plainMember)).toBe(true);
    // Promoting people stays the admin's job — MEMBER_CAPABILITIES deliberately
    // omits MANAGE_MEMBERS.
    expect(canManageMembers(plainMember)).toBe(false);
  });

  it('a member of an unrepaired workspace may do nothing at all', () => {
    // This is the state a swallowed setDefaultCapabilities leaves everyone in.
    expect(canCreateRepo(strandedMember)).toBe(false);
    expect(canInvite(strandedMember)).toBe(false);
    expect(canManageMembers(strandedMember)).toBe(false);
  });
});

describe('describeCapabilities', () => {
  it('names what the mask permits, in the order a person cares about', () => {
    expect(describeCapabilities(MEMBER_CAPABILITIES)).toEqual(['Add repos', 'Invite people']);
    expect(describeCapabilities(ALL_CAPABILITIES)).toEqual([
      'Add repos',
      'Invite people',
      'Manage members',
    ]);
  });

  it('is empty for a mask that permits nothing this app exposes', () => {
    expect(describeCapabilities(0)).toEqual([]);
    expect(describeCapabilities(CAP.CAN_JOIN_OPEN_SUBGROUPS)).toEqual([]);
  });
});

describe('withCapability', () => {
  it('adds and removes one bit, leaving the rest of the base alone', () => {
    const base = MEMBER_CAPABILITIES;
    expect(withCapability(base, CAP.MANAGE_MEMBERS, true)).toBe(
      MEMBER_CAPABILITIES | CAP.MANAGE_MEMBERS,
    );
    expect(withCapability(base, CAP.CAN_INVITE_MEMBERS, false)).toBe(CAP.CAN_CREATE_CONTEXT);
  });

  it('is a no-op when the bit is already in the wanted state', () => {
    expect(withCapability(MEMBER_CAPABILITIES, CAP.CAN_CREATE_CONTEXT, true)).toBe(
      MEMBER_CAPABILITIES,
    );
    expect(withCapability(0, CAP.CAN_CREATE_CONTEXT, false)).toBe(0);
  });

  it('called on an EFFECTIVE mask preserves inherited permissions', () => {
    // The bug this prevents: a member's stored override is 0 while their
    // effective mask is the default. Toggling one bit against the override
    // (`0 | bit`) would pin them to that single bit and silently strip the rest.
    const effective = effectiveCapabilities({
      role: ROLE_MEMBER,
      override: 0,
      groupDefault: MEMBER_CAPABILITIES,
    });
    expect(withCapability(effective, CAP.MANAGE_MEMBERS, true)).toBe(
      MEMBER_CAPABILITIES | CAP.MANAGE_MEMBERS,
    );
  });
});

describe('the workspace default', () => {
  it('is usable only when it carries BOTH baseline bits', () => {
    expect(defaultIsUsable(MEMBER_CAPABILITIES)).toBe(true);
    expect(defaultIsUsable(CAP.CAN_CREATE_CONTEXT)).toBe(false);
    expect(defaultIsUsable(0)).toBe(false);
    expect(defaultIsUsable(null)).toBe(false);
  });

  it('repairs by ADDING the baseline, never by replacing what is there', () => {
    // An admin may have deliberately granted something extra; a repair that
    // overwrote the mask would quietly revoke it.
    expect(repairedDefault(CAP.MANAGE_MEMBERS)).toBe(
      CAP.MANAGE_MEMBERS | MEMBER_CAPABILITIES,
    );
    expect(repairedDefault(0)).toBe(MEMBER_CAPABILITIES);
    expect(repairedDefault(null)).toBe(MEMBER_CAPABILITIES);
    expect(defaultIsUsable(repairedDefault(0))).toBe(true);
  });
});
