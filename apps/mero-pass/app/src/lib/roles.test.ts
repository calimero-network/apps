import { describe, expect, it } from 'vitest';
import { ORG_CAPABILITIES } from '@calimero-network/mero-js';

import {
  canCreateInviteOnlyVault,
  canCreateVault,
  canInvite,
  canManageMembers,
  normaliseRole,
  roleLabel,
} from './roles';
import {
  ALL_CAPABILITIES,
  MEMBER_DEFAULTS,
  capabilitiesOf,
  type OrgView,
} from './vaults';

const org = (
  members: Record<string, string>,
  extra: Partial<OrgView> = {},
): OrgView => ({
  name: 'T',
  members,
  memberMetadata: {},
  metadata: null,
  defaultCapabilities: MEMBER_DEFAULTS,
  capabilities: {},
  teams: {},
  ...extra,
});

describe('roles', () => {
  it('reads an owner as an Admin and a guest as a Member', () => {
    expect(normaliseRole('owner')).toBe('admin');
    expect(normaliseRole('admin')).toBe('admin');
    expect(normaliseRole('member')).toBe('member');
    expect(normaliseRole('guest')).toBe('member');
    expect(normaliseRole(undefined)).toBe('member');
    expect(roleLabel('admin')).toBe('Admin');
  });

  it('gives owners and admins every bit, members the org default or their own mask', () => {
    const view = org(
      { o: 'owner', a: 'admin', m: 'member', x: 'member' },
      { capabilities: { x: 0 } },
    );
    expect(capabilitiesOf(view, 'o')).toBe(ALL_CAPABILITIES);
    expect(capabilitiesOf(view, 'a')).toBe(ALL_CAPABILITIES);
    expect(capabilitiesOf(view, 'm')).toBe(MEMBER_DEFAULTS);
    expect(capabilitiesOf(view, 'x')).toBe(0);
    expect(capabilitiesOf(view, 'stranger')).toBeNull();
  });

  it('gates each action on its bit', () => {
    expect(canCreateVault(MEMBER_DEFAULTS)).toBe(true);
    expect(canInvite(MEMBER_DEFAULTS)).toBe(true);
    expect(canManageMembers(MEMBER_DEFAULTS)).toBe(false);
    expect(canCreateInviteOnlyVault(MEMBER_DEFAULTS)).toBe(false);
    expect(canCreateInviteOnlyVault(ALL_CAPABILITIES)).toBe(true);
    expect(canCreateVault(null)).toBe(false);
    expect(canInvite(ORG_CAPABILITIES.CREATE_APP)).toBe(false);
  });
});
