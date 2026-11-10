/**
 * Mero Pass's own app team (core#4890), against the shared in-memory cluster
 * (`@calimero-apps/connect/testing`), the way mero-chat's `chatAppTeam.test.ts`
 * pins Chat's: a new team (org) gets an open app team and open vaults go on
 * it (still open, never mistaken for invite-only); invites name it; the
 * people and an open vault's key audience are its people; Remove in an org
 * that keeps its apps apart keeps the person in the org; a legacy org works.
 */
import { describe, expect, it } from 'vitest';
import type { PasskeyProvider } from '@calimero-network/mero-js';
import { orgCluster } from '@calimero-apps/connect/testing';

import {
  createPersonalVault,
  createTeam,
  createVault,
  findVaultByContext,
  listTeamMembers,
  listVaults,
  mintTeamInvite,
  mintVaultInvite,
  removeTeamMember,
  vaultAudience,
} from './vaults';

const PKG = 'com.calimero.mero-pass';
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;

async function team(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const conn = { client: cluster.client, source: SOURCE, passkey };
  const { namespaceId: org, warning } = await createTeam(conn, 'Home');
  expect(warning).toBeNull();
  Object.assign(cluster.org(org).members, people);
  return { cluster, conn, org };
}

describe("a new team gets Mero Pass's own app team", () => {
  it('open (made with `shared: false`); an open vault is on it and still reads as open', async () => {
    const { cluster, conn, org } = await team();
    expect(cluster.modeOf(org)).toBe('standalone');
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const { contextId } = await createVault(conn, { namespaceId: org, name: 'Logins', restricted: false });
    expect(cluster.state.apps.get(contextId)!.access).toEqual({ kind: 'team', team: cluster.teamOf(org, PKG) });
    expect(await listVaults(conn, org)).toMatchObject([{ vaultId: contextId, restricted: false, team: null }]);
    expect(await findVaultByContext(conn, contextId)).toMatchObject({ restricted: false, team: null });
  });

  it('an invite-only vault keeps its own team', async () => {
    const { cluster, conn, org } = await team();
    const { contextId } = await createVault(conn, { namespaceId: org, name: 'Prod', restricted: true });
    const access = cluster.state.apps.get(contextId)!.access as { kind: string; team: string };
    expect(access.team).not.toBe(cluster.teamOf(org, PKG));
    expect(await listVaults(conn, org)).toMatchObject([{ restricted: true, team: access.team }]);
  });

  it('a declined team leaves a legacy org, whose open vaults use organization access as before', async () => {
    const cluster = orgCluster();
    cluster.state.declined.add('scopeApps');
    const conn = { client: cluster.client, source: SOURCE, passkey };
    const { namespaceId: org } = await createTeam(conn, 'Home');
    expect(cluster.modeOf(org)).toBe('legacy');
    await createVault(conn, { namespaceId: org, name: 'Logins', restricted: false });
    expect(cluster.callsOf('createApp')[0]![2]).toEqual({ org });
  });

  it('a private vault is its own org, marked personal', async () => {
    const cluster = orgCluster();
    const conn = { client: cluster.client, source: SOURCE, passkey };
    const { namespaceId } = await createPersonalVault(conn);
    expect(cluster.org(namespaceId).metadata).toEqual({ kind: 'personal' });
  });
});

describe('invites name the app team', () => {
  it('standalone: a team invite names it, a vault invite names it and the vault team', async () => {
    const { cluster, conn, org } = await team();
    const appTeam = cluster.teamOf(org, PKG);
    expect((await mintTeamInvite(conn, { namespaceId: org })).appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]!.slice(3)).toEqual([[appTeam], { ttlSecs: 86400 }]);
    await mintVaultInvite(conn, { namespaceId: org, team: 'vault-team', validForSecs: 60 });
    expect(cluster.callsOf('invite')[1]!.slice(3)).toEqual([[appTeam, 'vault-team'], { ttlSecs: 60 }]);
  });

  it('apps kept apart: the link gives Mero Pass only', async () => {
    const { cluster, conn, org } = await team();
    cluster.keepAppsApart(org);
    expect((await mintTeamInvite(conn, { namespaceId: org })).appOnly).toBe(true);
  });

  it('a legacy org: the org-wide invite, as before', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'legacy' });
    const conn = { client: cluster.client, source: SOURCE, passkey };
    expect((await mintTeamInvite(conn, { namespaceId: org })).appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]!.slice(3)).toEqual([undefined, { ttlSecs: 86400 }]);
  });
});

describe('people and the open vault key audience', () => {
  const people = { 'acct-bob': 'member', 'acct-cy': 'member', 'acct-gus': 'guest' };

  it("apps kept apart: only Mero Pass's people, for the list and an open vault's key", async () => {
    const { cluster, conn, org } = await team(people);
    const { contextId } = await createVault(conn, { namespaceId: org, name: 'Logins', restricted: false });
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ['acct-me', 'acct-bob'] });
    const listed = (await listTeamMembers(conn, org, 'acct-me')).map((m) => m.accountId).sort();
    expect(listed).toEqual(['acct-bob', 'acct-me']);
    expect(await vaultAudience(conn, { namespaceId: org, vaultId: contextId })).toEqual(new Set(['acct-me', 'acct-bob']));
  });

  it('standalone: every member, not a guest', async () => {
    const { conn, org } = await team(people);
    const listed = (await listTeamMembers(conn, org, 'acct-me')).map((m) => m.accountId).sort();
    expect(listed).toEqual(['acct-bob', 'acct-cy', 'acct-me']);
  });

  it('a legacy org: every org member', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'legacy', members: people });
    const conn = { client: cluster.client, source: SOURCE, passkey };
    expect((await listTeamMembers(conn, org, 'acct-me')).length).toBe(4);
  });
});

describe('Remove', () => {
  it('apps kept apart: out of Mero Pass and its invite-only vaults, never out of the org', async () => {
    const { cluster, conn, org } = await team({ 'acct-bob': 'member' });
    const { contextId } = await createVault(conn, { namespaceId: org, name: 'Prod', restricted: true });
    const vaultTeam = (cluster.state.apps.get(contextId)!.access as { team: string }).team;
    cluster.org(org).teams[vaultTeam]!.members['acct-bob'] = false;
    cluster.keepAppsApart(org);
    expect(await removeTeamMember(conn, { namespaceId: org, accountId: 'acct-bob' })).toBe('app');
    expect(cluster.callsOf('removeTeamMember').map((c) => c[1])).toEqual([cluster.teamOf(org, PKG), vaultTeam]);
    expect(cluster.org(org).members['acct-bob']).toBe('member');
  });

  it('standalone and legacy: out of the organization, as before', async () => {
    const { cluster, conn, org } = await team({ 'acct-bob': 'member' });
    expect(await removeTeamMember(conn, { namespaceId: org, accountId: 'acct-bob' })).toBe('org');
    expect(cluster.org(org).members['acct-bob']).toBeUndefined();
    const legacy = cluster.addOrg({ mode: 'legacy', members: { 'acct-bob': 'member' } });
    expect(await removeTeamMember(conn, { namespaceId: legacy, accountId: 'acct-bob' })).toBe('org');
  });
});

describe('adding Mero Pass to an organization whose apps have teams', () => {
  it('an admin: open in an open org, closed in one that keeps its apps apart', async () => {
    const cluster = orgCluster();
    const conn = { client: cluster.client, source: SOURCE, passkey };
    const open = cluster.addOrg({ mode: 'standalone', role: 'admin' });
    await createVault(conn, { namespaceId: open, name: 'Shared', restricted: false });
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const apart = cluster.addOrg({ mode: 'shared', role: 'admin' });
    await createVault(conn, { namespaceId: apart, name: 'Shared', restricted: false });
    expect(cluster.callsOf('scopeApps')[1]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it('a member is told only owners and admins can add it', async () => {
    const cluster = orgCluster();
    const conn = { client: cluster.client, source: SOURCE, passkey };
    const org = cluster.addOrg({ mode: 'standalone', role: 'member' });
    await expect(createVault(conn, { namespaceId: org, name: 'Shared', restricted: false })).rejects.toThrow(
      /owners and admins can add Mero Pass/,
    );
  });
});
