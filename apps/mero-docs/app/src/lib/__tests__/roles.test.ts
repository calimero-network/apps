import { describe, expect, it } from 'vitest';
import {
  canChangeRole,
  countAdmins,
  describeRoleChange,
  effectiveHasCap,
  folderRoleOf,
  folderRoleOfRegistryRole,
  FOLDER_ROLE_GRANTS,
  FOLDER_ROLES,
  parseGroupRole,
  planDefaultsSweep,
  registryManagerIntent,
  roleDisplayLabel,
  workspaceRoleOf,
  WORKSPACE_ROLE_GRANTS,
  WORKSPACE_ROLES,
  type GroupRole,
  type ShownRole,
} from '../roles';
import { CAPABILITIES, DEFAULT_NEW_MEMBER_CAPS } from '@/constants/config';

const C = CAPABILITIES;

describe('parseGroupRole', () => {
  it('passes the three server spellings through', () => {
    expect(parseGroupRole('Admin')).toBe('Admin');
    expect(parseGroupRole('Member')).toBe('Member');
    expect(parseGroupRole('ReadOnly')).toBe('ReadOnly');
  });

  // Both TEE roles are set by attestation, never by a person.
  it('keeps the two TEE roles apart from Member', () => {
    expect(parseGroupRole('ReadOnlyTee')).toBe('ReadOnlyTee');
    expect(parseGroupRole('RelayTee')).toBe('RelayTee');
    expect(workspaceRoleOf('ReadOnlyTee', 0)).toBe('Tee');
    expect(workspaceRoleOf('RelayTee', null)).toBe('Tee');
    expect(folderRoleOf('RelayTee', 'Editor', 0)).toBe('Tee');
    expect(folderRoleOfRegistryRole('ReadOnlyTee', 'Editor')).toBe('Tee');
    expect(roleDisplayLabel('Tee')).toBe('TEE node');
  });

  // Defaulting the other way would paint an admin badge on a plain member -
  // and, worse, let the last-admin guard miscount.
  it('defaults an unknown, empty or absent role to Member, never Admin', () => {
    expect(parseGroupRole(undefined)).toBe('Member');
    expect(parseGroupRole(null)).toBe('Member');
    expect(parseGroupRole('')).toBe('Member');
    expect(parseGroupRole('admin')).toBe('Member'); // case matters on the wire
    expect(parseGroupRole('Owner')).toBe('Member');
  });
});

describe('workspaceRoleOf', () => {
  it('maps every workspace role grant back to its role', () => {
    for (const role of WORKSPACE_ROLES) {
      const g = WORKSPACE_ROLE_GRANTS[role];
      expect(workspaceRoleOf(g.role, g.caps ?? 0)).toBe(role);
    }
  });

  // The server skips the bitmask for an Admin, so any mask is still Admin.
  it('reads an Admin as Admin whatever the mask', () => {
    expect(workspaceRoleOf('Admin', 0)).toBe('Admin');
    expect(workspaceRoleOf('Admin', null)).toBe('Admin');
    expect(workspaceRoleOf('Admin', 0xff)).toBe('Admin');
  });

  // The old workspace "Viewer" preset could still edit documents in open
  // folders, so it matches no role rather than borrowing one.
  it('shows Custom for states no role describes', () => {
    expect(workspaceRoleOf('Member', C.CAN_JOIN_OPEN_SUBGROUPS)).toBe('Custom');
    expect(workspaceRoleOf('Member', 0)).toBe('Custom');
    expect(workspaceRoleOf('ReadOnly', DEFAULT_NEW_MEMBER_CAPS)).toBe('Custom');
  });

  it('is null while a non-admin mask is loading', () => {
    expect(workspaceRoleOf('Member', null)).toBeNull();
    expect(workspaceRoleOf('ReadOnly', null)).toBeNull();
  });

  // Demoting an Admin whose stored mask is 0 must land on a mask that works.
  it('grants Editor the default new-member bits', () => {
    expect(WORKSPACE_ROLE_GRANTS.Editor).toEqual({
      role: 'Member',
      caps: DEFAULT_NEW_MEMBER_CAPS,
    });
  });

  // A ReadOnly member's bits ARE consulted, so the grant clears them. Without
  // the join bit they see only folders they were added to, hence Guest.
  it('grants Guest core ReadOnly and an empty mask', () => {
    expect(WORKSPACE_ROLE_GRANTS.Guest).toEqual({ role: 'ReadOnly', caps: 0 });
    expect(workspaceRoleOf('ReadOnly', 0)).toBe('Guest');
  });

  it('never offers the folder-only Read only role on the workspace', () => {
    expect(WORKSPACE_ROLES).not.toContain('ReadOnly');
    expect(FOLDER_ROLES).not.toContain('Guest');
  });
});

describe('folderRoleOf', () => {
  it('maps every folder role grant back to its role', () => {
    for (const role of FOLDER_ROLES) {
      const g = FOLDER_ROLE_GRANTS[role];
      expect(folderRoleOf(g.coreRole, g.role, g.folderCaps)).toBe(role);
    }
  });

  // Core discards every state write of a ReadOnly member, comments included.
  it('makes Read only core ReadOnly in the folder, plus the registry Viewer row', () => {
    expect(FOLDER_ROLE_GRANTS.ReadOnly).toEqual({
      coreRole: 'ReadOnly',
      role: 'Viewer',
      folderCaps: 0,
    });
    expect(FOLDER_ROLE_GRANTS.Editor.coreRole).toBe('Member');
    expect(FOLDER_ROLE_GRANTS.Manager.coreRole).toBe('Member');
    expect(roleDisplayLabel(folderRoleOf('ReadOnly', 'Viewer', 0)!)).toBe('Read only');
  });

  // Nothing enforces a Viewer row alone, so it must not read as Read only.
  it('shows a registry Viewer who is still a core Member as Custom', () => {
    expect(folderRoleOf('Member', 'Viewer', 0)).toBe('Custom');
    expect(folderRoleOfRegistryRole('Member', 'Viewer')).toBe('Custom');
  });

  // "Admin" is workspace vocabulary; in a folder the core admin is its owner.
  it('reads a core admin of the folder as Owner', () => {
    expect(folderRoleOf('Admin', 'Viewer', 0)).toBe('Owner');
    expect(folderRoleOfRegistryRole('Admin', 'Editor')).toBe('Owner');
    expect(roleDisplayLabel('Owner')).toBe('Owner');
  });

  it('shows a core ReadOnly member with a non-Viewer registry row as Custom', () => {
    expect(folderRoleOf('ReadOnly', 'Editor', 0)).toBe('Custom');
    expect(folderRoleOfRegistryRole('ReadOnly', 'Manager')).toBe('Custom');
  });

  it('shows Custom for an off-grant (role, caps) pair', () => {
    expect(folderRoleOf('Member', 'Editor', 0xff)).toBe('Custom');
    expect(folderRoleOf('Member', 'Manager', 0)).toBe('Custom');
  });

  it('is null while the folder caps are loading', () => {
    expect(folderRoleOf('Member', 'Editor', null)).toBeNull();
  });
});

// The read-only sharing list has the registry Role but no per-member caps.
describe('folderRoleOfRegistryRole', () => {
  it('names the role from the registry Role alone', () => {
    expect(folderRoleOfRegistryRole('ReadOnly', 'Viewer')).toBe('ReadOnly');
    expect(folderRoleOfRegistryRole('Member', 'Editor')).toBe('Editor');
    expect(folderRoleOfRegistryRole('Member', 'Manager')).toBe('Manager');
    expect(folderRoleOfRegistryRole('Admin', 'Viewer')).toBe('Owner');
  });
});

describe('describeRoleChange', () => {
  it('says what a promotion adds', () => {
    expect(describeRoleChange('Editor', 'Manager', 'workspace')).toBe(
      'In this workspace, they will be able to invite, rename and remove people.',
    );
  });

  it('says what a demotion takes away', () => {
    expect(describeRoleChange('Manager', 'ReadOnly', 'folder')).toBe(
      'In this folder, they will no longer be able to edit and comment on its documents, invite and remove its members or rename, restrict or delete it. They can open its documents but not edit or comment on them.',
    );
  });

  // Guest does not stop edits in folders they were added to; say what it does.
  it('says a Guest sees only folders shared with them directly', () => {
    expect(describeRoleChange('Editor', 'Guest', 'workspace')).toBe(
      'In this workspace, they will no longer be able to open folders shared with the whole workspace or create folders and documents. They will see only folders shared with them directly.',
    );
  });

  it('replaces custom permissions with the whole new role', () => {
    expect(describeRoleChange('Custom', 'Editor', 'workspace')).toBe(
      'Their custom permissions are replaced. In this workspace, they will be able to open folders shared with the whole workspace and create folders and documents.',
    );
    expect(describeRoleChange('Custom', 'ReadOnly', 'folder')).toBe(
      'Their custom permissions are replaced. In this folder, they can open its documents but not edit or comment on them.',
    );
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
    currentRole: 'Editor' as ShownRole,
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
      nextRole: 'Guest',
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
      nextRole: 'Editor',
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/your own role/i);
  });

  it('refuses demoting the last admin', () => {
    const v = canChangeRole({
      ...base,
      currentRole: 'Admin',
      adminCount: 1,
      nextRole: 'Editor',
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
        nextRole: 'Editor',
      }).allowed,
    ).toBe(true);
  });

  // Both sit on core role Member; only the bitmask differs.
  it('allows moving between Editor and Manager', () => {
    expect(canChangeRole({ ...base, nextRole: 'Manager' }).allowed).toBe(true);
  });

  it('allows replacing a Custom state with any role', () => {
    expect(
      canChangeRole({ ...base, currentRole: 'Custom', nextRole: 'Editor' }).allowed,
    ).toBe(true);
  });

  it('treats a no-op selection as not-allowed rather than a write', () => {
    const v = canChangeRole({ ...base, nextRole: 'Editor' });
    expect(v.allowed).toBe(false);
  });

  it('always gives a reason when it refuses', () => {
    const refusals = [
      canChangeRole({ ...base, nextRole: 'Editor' }),
      canChangeRole({ ...base, isSelf: true, nextRole: 'Admin' }),
      canChangeRole({
        ...base,
        currentRole: 'Admin',
        adminCount: 1,
        nextRole: 'Editor',
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
    { identity: 'e', role: 'RelayTee' },
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
    ).toEqual(['c', 'e']);
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

describe('roleDisplayLabel', () => {
  it('renders ReadOnly as "Read only" for display', () => {
    expect(roleDisplayLabel('ReadOnly')).toBe('Read only');
  });

  it('leaves the other roles as they are spelled', () => {
    expect(roleDisplayLabel('Guest')).toBe('Guest');
    expect(roleDisplayLabel('Admin')).toBe('Admin');
    expect(roleDisplayLabel('Manager')).toBe('Manager');
    expect(roleDisplayLabel('Editor')).toBe('Editor');
    expect(roleDisplayLabel('Custom')).toBe('Custom');
  });
});
