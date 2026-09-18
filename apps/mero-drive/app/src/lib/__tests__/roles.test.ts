import { describe, expect, it } from 'vitest';
import {
  canChangeRole,
  capabilitiesForRole,
  countAdmins,
  effectiveHasCap,
  parseGroupRole,
  planDefaultsSweep,
  registryManagerIntent,
  type GroupRole,
} from '../roles';
import { CAPABILITIES, DEFAULT_NEW_MEMBER_CAPS } from '@/constants/config';

const C = CAPABILITIES;

describe('parseGroupRole', () => {
  it('passes the three server spellings through', () => {
    expect(parseGroupRole('Admin')).toBe('Admin');
    expect(parseGroupRole('Member')).toBe('Member');
    expect(parseGroupRole('ReadOnly')).toBe('ReadOnly');
  });

  // Defaulting the other way would paint an admin badge on a plain member —
  // and, worse, let the last-admin guard miscount.
  it('defaults an unknown, empty or absent role to Member, never Admin', () => {
    expect(parseGroupRole(undefined)).toBe('Member');
    expect(parseGroupRole(null)).toBe('Member');
    expect(parseGroupRole('')).toBe('Member');
    expect(parseGroupRole('admin')).toBe('Member'); // case matters on the wire
    expect(parseGroupRole('Owner')).toBe('Member');
  });
});

describe('capabilitiesForRole', () => {
  // The headline bug this function exists for: an Admin's bitmask is usually
  // 0 because nothing ever needed to set it, so demoting them without seeding
  // one produces a member who can do nothing at all and no error anywhere.
  it('seeds the Editor default when demoting an Admin whose mask is 0', () => {
    expect(capabilitiesForRole('Member', 0)).toBe(DEFAULT_NEW_MEMBER_CAPS);
  });

  it('seeds the Editor default when the mask is unknown', () => {
    expect(capabilitiesForRole('Member', null)).toBe(DEFAULT_NEW_MEMBER_CAPS);
  });

  // Re-selecting 'Member' on someone who is already a Member must not reset
  // a deliberately-chosen preset.
  it('leaves a non-zero mask alone when moving to Member', () => {
    expect(capabilitiesForRole('Member', C.CAN_JOIN_OPEN_SUBGROUPS)).toBeNull();
    expect(capabilitiesForRole('Member', DEFAULT_NEW_MEMBER_CAPS)).toBeNull();
  });

  // Widening on promotion would leave an over-granted mask behind for the day
  // they are demoted; the server does not read it while they are an Admin.
  it('writes nothing when promoting to Admin', () => {
    expect(capabilitiesForRole('Admin', 0)).toBeNull();
    expect(capabilitiesForRole('Admin', null)).toBeNull();
    expect(capabilitiesForRole('Admin', DEFAULT_NEW_MEMBER_CAPS)).toBeNull();
  });

  // A ReadOnly member's bits ARE consulted — the label is not a separate gate.
  it('clears the mask for ReadOnly so the label is not a lie', () => {
    expect(capabilitiesForRole('ReadOnly', DEFAULT_NEW_MEMBER_CAPS)).toBe(0);
    expect(capabilitiesForRole('ReadOnly', null)).toBe(0);
  });

  it('never returns a mask that omits a bit the Editor default has', () => {
    const seeded = capabilitiesForRole('Member', 0);
    expect(seeded).not.toBeNull();
    for (const bit of [
      C.CAN_JOIN_OPEN_SUBGROUPS,
      C.CAN_CREATE_SUBGROUP,
      C.CAN_CREATE_CONTEXT,
    ]) {
      expect((seeded! & bit) === bit).toBe(true);
    }
  });
});

describe('effectiveHasCap', () => {
  it('short-circuits every bit for an Admin, mirroring the server', () => {
    expect(effectiveHasCap('Admin', 0, C.MANAGE_MEMBERS)).toBe(true);
    expect(effectiveHasCap('Admin', null, C.CAN_CREATE_CONTEXT)).toBe(true);
  });

  it('reads the bitmask for a Member', () => {
    expect(effectiveHasCap('Member', C.MANAGE_MEMBERS, C.MANAGE_MEMBERS)).toBe(
      true,
    );
    expect(effectiveHasCap('Member', C.CAN_CREATE_CONTEXT, C.MANAGE_MEMBERS)).toBe(
      false,
    );
    expect(effectiveHasCap('Member', null, C.CAN_CREATE_CONTEXT)).toBe(false);
  });

  // Deliberate: a ReadOnly member with bits set really can act, and pretending
  // otherwise here would hide the state the clear-on-demote exists to prevent.
  it('does not treat ReadOnly as a separate gate', () => {
    expect(effectiveHasCap('ReadOnly', C.CAN_CREATE_CONTEXT, C.CAN_CREATE_CONTEXT)).toBe(
      true,
    );
    expect(effectiveHasCap('ReadOnly', 0, C.CAN_CREATE_CONTEXT)).toBe(false);
  });
});

describe('canChangeRole', () => {
  const base = {
    currentRole: 'Member' as GroupRole,
    isSelf: false,
    actorRole: 'Admin' as GroupRole,
    actorCaps: null as number | null,
    adminCount: 2,
  };

  it('lets an admin promote a member', () => {
    expect(canChangeRole({ ...base, nextRole: 'Admin' }).allowed).toBe(true);
  });

  it('lets a member with MANAGE_MEMBERS change roles', () => {
    const v = canChangeRole({
      ...base,
      actorRole: 'Member',
      actorCaps: C.MANAGE_MEMBERS,
      nextRole: 'ReadOnly',
    });
    expect(v.allowed).toBe(true);
  });

  it('refuses a member without MANAGE_MEMBERS', () => {
    const v = canChangeRole({
      ...base,
      actorRole: 'Member',
      actorCaps: C.CAN_CREATE_CONTEXT,
      nextRole: 'Admin',
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/Manage members/i);
  });

  // Self-demotion is a one-way door: the controls to undo it go with the role.
  it('refuses any change to your own row', () => {
    const v = canChangeRole({
      ...base,
      currentRole: 'Admin',
      isSelf: true,
      nextRole: 'Member',
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/your own role/i);
  });

  it('refuses demoting the last admin', () => {
    const v = canChangeRole({
      ...base,
      currentRole: 'Admin',
      adminCount: 1,
      nextRole: 'Member',
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/only admin/i);
  });

  it('allows demoting an admin when another remains', () => {
    expect(
      canChangeRole({
        ...base,
        currentRole: 'Admin',
        adminCount: 2,
        nextRole: 'Member',
      }).allowed,
    ).toBe(true);
  });

  it('treats a no-op selection as not-allowed rather than a write', () => {
    const v = canChangeRole({ ...base, nextRole: 'Member' });
    expect(v.allowed).toBe(false);
  });

  it('always gives a reason when it refuses', () => {
    const refusals = [
      canChangeRole({ ...base, nextRole: 'Member' }),
      canChangeRole({ ...base, isSelf: true, nextRole: 'Admin' }),
      canChangeRole({
        ...base,
        currentRole: 'Admin',
        adminCount: 1,
        nextRole: 'Member',
      }),
      canChangeRole({
        ...base,
        actorRole: 'Member',
        actorCaps: 0,
        nextRole: 'Admin',
      }),
    ];
    for (const r of refusals) {
      expect(r.allowed).toBe(false);
      expect(r.reason && r.reason.length > 0).toBe(true);
    }
  });
});

describe('registryManagerIntent', () => {
  // Core admin does not imply registry manager; a core-only promotion makes an
  // "Admin" the app's own contract refuses.
  it('adds on promotion to Admin', () => {
    expect(registryManagerIntent('Member', 'Admin')).toBe('add');
    expect(registryManagerIntent('ReadOnly', 'Admin')).toBe('add');
  });

  it('removes on demotion out of Admin', () => {
    expect(registryManagerIntent('Admin', 'Member')).toBe('remove');
    expect(registryManagerIntent('Admin', 'ReadOnly')).toBe('remove');
  });

  it('does nothing when Admin-ness is unchanged', () => {
    expect(registryManagerIntent('Member', 'ReadOnly')).toBe('none');
    expect(registryManagerIntent('ReadOnly', 'Member')).toBe('none');
    expect(registryManagerIntent('Admin', 'Admin')).toBe('none');
  });
});

describe('countAdmins', () => {
  it('counts only Admin rows', () => {
    expect(
      countAdmins([
        { role: 'Admin' },
        { role: 'Member' },
        { role: 'Admin' },
        { role: 'ReadOnly' },
        {},
      ]),
    ).toBe(2);
  });

  it('is 0 for an empty roster', () => {
    expect(countAdmins([])).toBe(0);
  });
});

describe('planDefaultsSweep', () => {
  const roster = [
    { identity: 'a', role: 'Admin' },
    { identity: 'b', role: 'Member' },
    { identity: 'c', role: 'ReadOnly' },
    { identity: 'd' },
  ];

  it('applies to plain members only', () => {
    const plan = planDefaultsSweep(roster);
    expect(plan.apply.map((m) => m.identity)).toEqual(['b', 'd']);
  });

  // Their bitmask is not consulted, and a narrow default would arm a trap for
  // the day they are demoted.
  it('skips admins', () => {
    expect(planDefaultsSweep(roster).skippedAdmins.map((m) => m.identity)).toEqual(
      ['a'],
    );
  });

  // The important one: a ReadOnly member's bits ARE read, so handing them the
  // default mask makes a read-only member who can write.
  it('skips read-only members', () => {
    expect(
      planDefaultsSweep(roster).skippedReadOnly.map((m) => m.identity),
    ).toEqual(['c']);
  });

  it('partitions the roster with no member counted twice or dropped', () => {
    const plan = planDefaultsSweep(roster);
    const total =
      plan.apply.length + plan.skippedAdmins.length + plan.skippedReadOnly.length;
    expect(total).toBe(roster.length);
  });

  it('handles an empty roster', () => {
    const plan = planDefaultsSweep([]);
    expect(plan.apply).toEqual([]);
    expect(plan.skippedAdmins).toEqual([]);
    expect(plan.skippedReadOnly).toEqual([]);
  });
});
