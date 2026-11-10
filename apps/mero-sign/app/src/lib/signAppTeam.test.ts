/**
 * Mero Sign's own app team (core#4890), against the shared in-memory cluster
 * (`@calimero-apps/connect/testing`), the way mero-chat's `chatAppTeam.test.ts`
 * pins Chat's. Sign has no organization-level Remove or Leave (an agreement's
 * roster is the contract's), so what is pinned: a new workspace gets an open
 * app team and agreements go on it; invites name it; the people are its
 * people; adding Sign to an org whose apps have teams; a legacy org.
 */
import { describe, expect, it } from 'vitest';
import type { PasskeyProvider } from '@calimero-network/mero-js';
import { orgCluster } from '@calimero-apps/connect/testing';

import { createAgreement, createWorkspace, readMembers } from './agreements';
import { appInviteToken } from './invites';

const PKG = 'com.calimero.mero-sign';
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;
const agreement = (cluster: ReturnType<typeof orgCluster>, org: string) =>
  createAgreement(cluster.client, { source: SOURCE, org, name: 'NDA', accountId: cluster.state.me, passkey });

async function workspace(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { namespaceId: org, warning } = await createWorkspace(cluster.client, 'Acme', passkey, undefined, SOURCE);
  expect(warning).toBeNull();
  Object.assign(cluster.org(org).members, people);
  return { cluster, org };
}

describe("a new workspace gets Mero Sign's own app team", () => {
  it('open (made with `shared: false`), and an agreement goes on it', async () => {
    const { cluster, org } = await workspace();
    expect(cluster.modeOf(org)).toBe('standalone');
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const app = await agreement(cluster, org);
    expect(cluster.state.apps.get(app)!.access).toEqual({ kind: 'team', team: cluster.teamOf(org, PKG) });
  });

  it('a declined team leaves a legacy workspace, whose agreements use organization access as before', async () => {
    const cluster = orgCluster();
    cluster.state.declined.add('scopeApps');
    const { namespaceId: org } = await createWorkspace(cluster.client, 'Acme', passkey, undefined, SOURCE);
    expect(cluster.modeOf(org)).toBe('legacy');
    await agreement(cluster, org);
    expect(cluster.callsOf('createApp')[0]![2]).toEqual({ org });
  });
});

describe('invites and people', () => {
  const people = { 'acct-bob': 'member', 'acct-cy': 'member', 'acct-gus': 'guest' };

  it('standalone: the invite names the team; every member but a guest', async () => {
    const { cluster, org } = await workspace(people);
    expect((await appInviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(['acct-me', 'acct-bob', 'acct-cy']);
  });

  it('apps kept apart: Mero Sign only, and only its people', async () => {
    const { cluster, org } = await workspace(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ['acct-me', 'acct-bob'] });
    expect((await appInviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(true);
    const read = await readMembers(cluster.client, org, SOURCE);
    expect(read.people).toEqual(['acct-me', 'acct-bob']);
    expect(read.appOnly).toBe(true);
  });

  it('a legacy org: the org-wide invite, every member', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'legacy', members: people });
    expect((await appInviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]![3]).toBeUndefined();
    expect((await readMembers(cluster.client, org, SOURCE)).people).toHaveLength(4);
  });
});

describe('adding Mero Sign to an organization whose apps have teams', () => {
  it('an admin: open in an open org, closed in one that keeps its apps apart', async () => {
    const cluster = orgCluster();
    const open = cluster.addOrg({ mode: 'standalone', role: 'admin' });
    await agreement(cluster, open);
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const apart = cluster.addOrg({ mode: 'shared', role: 'admin' });
    await agreement(cluster, apart);
    expect(cluster.callsOf('scopeApps')[1]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it('a member is told only owners and admins can add it, and nothing is made', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'standalone', role: 'member' });
    await expect(agreement(cluster, org)).rejects.toThrow(/owners and admins can add Mero Sign/);
    expect(cluster.callsOf('createApp')).toEqual([]);
  });
});
