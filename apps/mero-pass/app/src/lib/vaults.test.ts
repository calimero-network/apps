import { describe, expect, it, vi } from 'vitest';
import type { CalimeroClient } from '@calimero-network/mero-js';

import {
  MEMBER_DEFAULTS,
  PERSONAL,
  createPersonalVault,
  createTeam,
  createVault,
  findVaultByContext,
  listTeamMembers,
  listTeams,
  listVaults,
  mintVaultInvite,
  redeemInvite,
  vaultAudience,
} from './vaults';

/** A fake `CalimeroClient` over one org with an open and an invite-only vault. */
function fakeClient(overrides: Record<string, unknown> = {}) {
  const orgs: Record<string, Record<string, unknown>> = {
    org1: {
      name: 'Acme',
      members: { me: 'owner', bob: 'member', gus: 'guest' },
      memberMetadata: { bob: { name: 'Bob' } },
      metadata: null,
      defaultCapabilities: MEMBER_DEFAULTS,
      capabilities: {},
      teams: {
        t1: {
          teamId: 't1',
          name: 'Prod',
          join: 'invite',
          members: { bob: true },
        },
      },
    },
    org2: {
      name: 'Private',
      members: { me: 'owner' },
      metadata: PERSONAL,
      teams: {},
    },
  };
  const apps = [
    {
      appId: 'open1',
      name: 'Shared',
      owner: 'me',
      org: 'org1',
      bundle: 'b',
      package: null,
      version: null,
    },
    {
      appId: 'prod1',
      name: 'Prod keys',
      owner: 'me',
      org: 'org1',
      bundle: 'b',
      package: null,
      version: null,
    },
    {
      appId: 'mine1',
      name: 'Private',
      owner: 'me',
      org: 'org2',
      bundle: 'b',
      package: null,
      version: null,
    },
  ];
  const client = {
    me: vi.fn(async () => ({
      accountId: 'me',
      name: 'Me',
      orgs: [
        { orgId: 'org1', name: 'Acme', role: 'owner' },
        { orgId: 'org2', name: 'Private', role: 'owner' },
      ],
    })),
    getOrg: vi.fn(
      async (org: string) =>
        orgs[org] ?? { name: 'New', members: { me: 'owner' } },
    ),
    listApps: vi.fn(async () => apps),
    getApp: vi.fn(async (id: string) => ({
      access: id === 'prod1' ? { kind: 'team', team: 't1' } : { kind: 'org' },
    })),
    createOrg: vi.fn(async () => 'org9'),
    setCapabilities: vi.fn(async () => {}),
    setOrgMetadata: vi.fn(async () => {}),
    setMemberMetadata: vi.fn(async () => {}),
    createTeam: vi.fn(async () => 'team9'),
    createApp: vi.fn(async () => 'app9'),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    invite: vi.fn(async () => 'token'),
    redeemInvite: vi.fn(async () => ({ org: 'org1' })),
    ...overrides,
  };
  return client as typeof client & CalimeroClient;
}

const passkey = () => ({}) as never;

describe('teams and vaults on orgs and app instances', () => {
  it('lists each org as a team, with its vaults, members and the personal marker', async () => {
    const client = fakeClient();
    expect(await listTeams({ client, source: 'b' })).toEqual([
      {
        namespaceId: 'org1',
        name: 'Acme',
        role: 'owner',
        memberCount: 3,
        vaultCount: 2,
        personal: false,
      },
      {
        namespaceId: 'org2',
        name: 'Private',
        role: 'owner',
        memberCount: 1,
        vaultCount: 1,
        personal: true,
      },
    ]);
    expect(client.listApps).toHaveBeenCalledWith({ bundle: 'b' });
    await listTeams({ client, source: { package: 'com.calimero.mero-pass' } });
    expect(client.listApps).toHaveBeenLastCalledWith({
      package: 'com.calimero.mero-pass',
    });
  });

  it('lists an org’s vaults, the invite-only one with its team', async () => {
    const vaults = await listVaults(
      { client: fakeClient(), source: 'b' },
      'org1',
    );
    expect(vaults).toEqual([
      {
        vaultId: 'prod1',
        name: 'Prod keys',
        contextId: 'prod1',
        memberCount: 2,
        joined: true,
        restricted: true,
        team: 't1',
      },
      {
        vaultId: 'open1',
        name: 'Shared',
        contextId: 'open1',
        memberCount: 3,
        joined: true,
        restricted: false,
        team: null,
      },
    ]);
  });

  it('creates a team whose members may add vaults and invite', async () => {
    const client = fakeClient();
    const made = await createTeam({ client, source: 'b', passkey }, 'New');
    expect(made).toEqual({ namespaceId: 'org9', warning: null });
    expect(client.setCapabilities).toHaveBeenCalledWith(
      'org9',
      MEMBER_DEFAULTS,
      {},
    );
    expect(client.setMemberMetadata).toHaveBeenCalledWith('org9', 'me', {
      name: 'Me',
    });
  });

  it('keeps the team when the member defaults are refused, and says so', async () => {
    const client = fakeClient({
      setCapabilities: vi.fn(async () => {
        throw new Error('cancelled');
      }),
    });
    const made = await createTeam({ client, source: 'b', passkey }, 'New');
    expect(made.namespaceId).toBe('org9');
    expect(made.warning).toMatch(/passkey/);
  });

  it('creates an open vault, and an invite-only one behind its own team, naming each', async () => {
    const client = fakeClient();
    await createVault(
      { client, source: 'b', passkey },
      { namespaceId: 'org1', name: 'Ops', restricted: false },
    );
    expect(client.createApp).toHaveBeenLastCalledWith('Ops', 'b', {
      org: 'org1',
    });
    expect(client.call).toHaveBeenLastCalledWith('app9', 'renameVault', {
      name: 'Ops',
    });

    await createVault(
      { client, source: 'b', passkey },
      { namespaceId: 'org1', name: 'Prod', restricted: true },
    );
    expect(client.createTeam).toHaveBeenCalledWith('org1', 'Prod', 'invite');
    expect(client.createApp).toHaveBeenLastCalledWith('Prod', 'b', {
      org: 'org1',
      access: { kind: 'team', team: 'team9' },
    });
  });

  it('creates a private vault in an org marked personal', async () => {
    const client = fakeClient();
    expect(await createPersonalVault({ client, source: 'b', passkey })).toEqual(
      {
        contextId: 'app9',
        namespaceId: 'org9',
      },
    );
    expect(client.setOrgMetadata).toHaveBeenCalledWith('org9', PERSONAL);
  });

  it('finds a vault’s team and kind from its instance id', async () => {
    const client = fakeClient();
    expect(await findVaultByContext({ client, source: 'b' }, 'prod1')).toEqual({
      namespaceId: 'org1',
      vaultId: 'prod1',
      name: 'Prod keys',
      restricted: true,
      team: 't1',
      personal: false,
    });
    expect(
      (await findVaultByContext({ client, source: 'b' }, 'mine1'))?.personal,
    ).toBe(true);
    expect(
      await findVaultByContext({ client, source: 'b' }, 'nope'),
    ).toBeNull();
  });

  it('entitles the org to an open vault and only the team (and creator) to an invite-only one', async () => {
    const client = fakeClient();
    expect(
      await vaultAudience(
        { client, source: 'b' },
        { namespaceId: 'org1', vaultId: 'open1' },
      ),
    ).toEqual(new Set(['me', 'bob', 'gus']));
    expect(
      await vaultAudience(
        { client, source: 'b' },
        { namespaceId: 'org1', vaultId: 'prod1' },
      ),
    ).toEqual(new Set(['bob', 'me']));
    const failing = fakeClient({
      getOrg: vi.fn(async () => Promise.reject(new Error('down'))),
    });
    expect(
      await vaultAudience(
        { client: failing, source: 'b' },
        { namespaceId: 'org1', vaultId: 'open1' },
      ),
    ).toBeNull();
  });

  it('invites to an invite-only vault through its team', async () => {
    const client = fakeClient();
    await mintVaultInvite(
      { client, source: 'b', passkey },
      { namespaceId: 'org1', team: 't1', validForSecs: 60 },
    );
    expect(client.invite).toHaveBeenCalledWith('org1', 'member', {}, ['t1'], {
      ttlSecs: 60,
    });
    await mintVaultInvite(
      { client, source: 'b', passkey },
      { namespaceId: 'org1', team: null },
    );
    expect(client.invite).toHaveBeenLastCalledWith(
      'org1',
      'member',
      {},
      undefined,
      { ttlSecs: 86400 },
    );
  });

  it('redeems an invite into the team it names', async () => {
    const client = fakeClient();
    expect(await redeemInvite({ client }, ' token ')).toEqual({
      kind: 'team',
      namespaceId: 'org1',
    });
    expect(client.redeemInvite).toHaveBeenCalledWith('token');
    const vague = fakeClient({ redeemInvite: vi.fn(async () => ({})) });
    expect(await redeemInvite({ client: vague }, 't')).toEqual({
      kind: 'joined',
    });
  });

  it('lists the team’s people by name, owners and admins as Admin', async () => {
    const people = await listTeamMembers(
      { client: fakeClient() },
      'org1',
      'me',
    );
    expect(
      people.map((p) => [p.accountId, p.name, p.role, p.rawRole, p.isSelf]),
    ).toEqual([
      ['bob', 'Bob', 'member', 'member', false],
      ['gus', '', 'member', 'guest', false],
      ['me', '', 'admin', 'owner', true],
    ]);
  });
});
