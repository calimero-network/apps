// @vitest-environment jsdom
/**
 * Mero Sheets' own app team (core#4890), against the shared in-memory cluster
 * (`@calimero-apps/connect/testing`), the way mero-chat's `chatAppTeam.test.ts`
 * pins Chat's. Sheets has no Leave (only Remove), so what is pinned: a new
 * workspace gets an open app team and spreadsheets go on it; invites name it;
 * the people are its people; Remove in an org that keeps its apps apart keeps
 * the person in the org; adding Sheets to an org whose apps have teams; a
 * legacy org as before.
 */
import { describe, expect, it } from 'vitest';
import type { PasskeyProvider } from '@calimero-network/mero-js';
import { orgCluster } from '@calimero-apps/connect/testing';

import { createSpreadsheet, ensureWorkspace, mintInvite, readMembers, removeFromWorkspace } from './workspaces';

const PKG = 'com.calimero.mero-sheets';
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;

async function workspace(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { orgId: org, warning } = await ensureWorkspace(cluster.client, { existing: null, name: 'Sheets', passkey, source: SOURCE });
  expect(warning).toBeNull();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

describe("a new workspace gets Mero Sheets' own app team", () => {
  it('open (made with `shared: false`), and a spreadsheet goes on it', async () => {
    const { cluster, org } = await workspace();
    expect(cluster.modeOf(org)).toBe('standalone');
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const sheet = await createSpreadsheet(cluster.client, SOURCE, org, 'Budget', passkey);
    expect(cluster.state.apps.get(sheet)!.access).toEqual({ kind: 'team', team: cluster.teamOf(org, PKG) });
  });

  it('a declined team leaves a legacy workspace, whose spreadsheets use organization access as before', async () => {
    const cluster = orgCluster();
    cluster.state.declined.add('scopeApps');
    const { orgId: org } = await ensureWorkspace(cluster.client, { existing: null, name: 'Sheets', passkey, source: SOURCE });
    expect(cluster.modeOf(org)).toBe('legacy');
    await createSpreadsheet(cluster.client, SOURCE, org, 'Budget', passkey);
    expect(cluster.callsOf('createApp')[0]![2]).toEqual({ org });
  });

  it('a raw dev bundle has no package: no team is asked for', async () => {
    const cluster = orgCluster();
    await ensureWorkspace(cluster.client, { existing: null, name: 'Sheets', passkey, source: 'bundle-hash' });
    expect(cluster.callsOf('scopeApps')).toEqual([]);
  });
});

describe('invites and people', () => {
  const people = { 'acct-bob': 'member', 'acct-cy': 'member', 'acct-gus': 'guest' };

  it('standalone: the invite names the team; every member but a guest', async () => {
    const { cluster, org } = await workspace(people);
    expect((await mintInvite(cluster.client, { org, sheet: null, passkey, source: SOURCE })).appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(['acct-me', 'acct-bob', 'acct-cy']);
  });

  it('apps kept apart: Mero Sheets only, and only its people', async () => {
    const { cluster, org } = await workspace(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ['acct-me', 'acct-bob'] });
    expect((await mintInvite(cluster.client, { org, sheet: null, passkey, source: SOURCE })).appOnly).toBe(true);
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(['acct-me', 'acct-bob']);
  });

  it('a legacy org: the org-wide invite, every member', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'legacy', members: people });
    expect((await mintInvite(cluster.client, { org, sheet: null, passkey, source: SOURCE })).appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]![3]).toBeUndefined();
    expect((await readMembers(cluster.client, org, SOURCE)).people).toHaveLength(4);
  });
});

describe('Remove', () => {
  it('apps kept apart: out of Mero Sheets, never out of the organization', async () => {
    const { cluster, org } = await workspace({ 'acct-bob': 'member' });
    cluster.keepAppsApart(org);
    expect(await removeFromWorkspace(cluster.client, org, SOURCE, 'acct-bob', passkey)).toBe('app');
    expect(cluster.org(org).members['acct-bob']).toBe('member');
  });

  it('standalone and legacy: out of the organization, as before', async () => {
    const { cluster, org } = await workspace({ 'acct-bob': 'member' });
    expect(await removeFromWorkspace(cluster.client, org, SOURCE, 'acct-bob', passkey)).toBe('org');
    expect(cluster.org(org).members['acct-bob']).toBeUndefined();
    const legacy = cluster.addOrg({ mode: 'legacy', members: { 'acct-bob': 'member' } });
    expect(await removeFromWorkspace(cluster.client, legacy, SOURCE, 'acct-bob', passkey)).toBe('org');
  });
});

describe('adding Mero Sheets to an organization whose apps have teams', () => {
  it('an admin: open in an open org, closed in one that keeps its apps apart', async () => {
    const cluster = orgCluster();
    const open = cluster.addOrg({ mode: 'standalone', role: 'admin' });
    await createSpreadsheet(cluster.client, SOURCE, open, 'Budget', passkey);
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const apart = cluster.addOrg({ mode: 'shared', role: 'admin' });
    await createSpreadsheet(cluster.client, SOURCE, apart, 'Budget', passkey);
    expect(cluster.callsOf('scopeApps')[1]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it('a member is told only owners and admins can add it, and nothing is made', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'standalone', role: 'member' });
    await expect(createSpreadsheet(cluster.client, SOURCE, org, 'Budget', passkey)).rejects.toThrow(
      /owners and admins can add/,
    );
    expect(cluster.callsOf('createApp')).toEqual([]);
  });
});
