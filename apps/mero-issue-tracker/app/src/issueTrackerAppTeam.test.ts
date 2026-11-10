// @vitest-environment jsdom
/**
 * Mero Issue Tracker's own app team (core#4890), against the shared in-memory
 * cluster (`@calimero-apps/connect/testing`), the way mero-chat's
 * `chatAppTeam.test.ts` pins Chat's: a new workspace gets an open team, a
 * repository goes on it, an invite names it, the member list is its people,
 * Remove in an org that keeps its apps apart keeps the person in the org,
 * and a legacy org works as before.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PasskeyProvider } from '@calimero-network/mero-js';
import { orgCluster } from '@calimero-apps/connect/testing';

import { useMemberRoles } from './hooks/useMemberRoles';
import { addRepo, createWorkspace, inviteToken, readMembers } from './workspaces';

const PKG = 'com.calimero.mero-issue-tracker';
const SOURCE = { package: PKG };
const passkey = () => ({}) as PasskeyProvider;
const noop = () => {};

async function workspace(people: Record<string, string> = {}) {
  const cluster = orgCluster();
  const { namespaceId } = await createWorkspace(cluster.client, 'Acme', passkey, SOURCE);
  Object.assign(cluster.org(namespaceId).members, people);
  return { cluster, org: namespaceId };
}

async function removeWithHook(cluster: ReturnType<typeof orgCluster>, org: string, account: string) {
  const state = await readMembers(cluster.client, org, SOURCE);
  const { result } = renderHook(() =>
    useMemberRoles({
      client: cluster.client,
      org,
      self: cluster.state.me,
      state,
      refetch: async () => {},
      passkey,
      after: noop,
      source: SOURCE,
    }),
  );
  await act(() => result.current.removeMember(account));
  return result.current;
}

describe('a new workspace gets Mero Issue Tracker\'s own app team', () => {
  it('open (standalone), made with `shared: false`, and the first repository is on it', async () => {
    const { cluster, org } = await workspace();
    const team = cluster.teamOf(org, PKG)!;
    expect(cluster.modeOf(org)).toBe('standalone');
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const app = await addRepo(cluster.client, SOURCE, org, 'Main', '', passkey);
    expect(cluster.state.apps.get(app)!.access).toEqual({ kind: 'team', team });
  });

  it('a declined team leaves a legacy workspace, whose repositorys use organization access as before', async () => {
    const cluster = orgCluster();
    cluster.state.declined.add('scopeApps');
    const { namespaceId: org } = await createWorkspace(cluster.client, 'Acme', passkey, SOURCE);
    expect(cluster.modeOf(org)).toBe('legacy');
    await addRepo(cluster.client, SOURCE, org, 'Main', '', passkey);
    expect(cluster.callsOf('createApp')[0]![2]).toEqual({ org });
  });

  it('a raw dev bundle (`pnpm dev:local`) has no package: no team is asked for', async () => {
    const cluster = orgCluster();
    await createWorkspace(cluster.client, 'Acme', passkey, 'bundle-hash');
    expect(cluster.callsOf('scopeApps')).toEqual([]);
  });
});

describe('invites name the app team', () => {
  it('standalone: the team is named; the link is not app-only', async () => {
    const { cluster, org } = await workspace();
    const made = await inviteToken(cluster.client, org, passkey(), SOURCE);
    expect(made.appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]!.slice(0, 2)).toEqual([org, 'member']);
    expect(cluster.callsOf('invite')[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
  });

  it('apps kept apart: the same call, and the link gives Mero Issue Tracker only', async () => {
    const { cluster, org } = await workspace();
    cluster.keepAppsApart(org);
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(true);
    expect(cluster.callsOf('invite')[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
  });

  it('a legacy org: the org-wide invite, as before', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'legacy' });
    expect((await inviteToken(cluster.client, org, passkey(), SOURCE)).appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]![3]).toBeUndefined();
  });
});

describe('the member list is the app team', () => {
  const people = { 'acct-bob': 'member', 'acct-cy': 'member', 'acct-gus': 'guest' };

  it('standalone: every member, not a guest without a row', async () => {
    const { cluster, org } = await workspace(people);
    const read = await readMembers(cluster.client, org, SOURCE);
    expect(read.people).toEqual(['acct-me', 'acct-bob', 'acct-cy']);
    expect(read.appOnly).toBe(false);
  });

  it('apps kept apart: only the people in Mero Issue Tracker; roles still cover the org', async () => {
    const { cluster, org } = await workspace(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ['acct-me', 'acct-bob'] });
    const read = await readMembers(cluster.client, org, SOURCE);
    expect(read.people).toEqual(['acct-me', 'acct-bob']);
    expect(read.appOnly).toBe(true);
    expect(read.roles.get('acct-cy')).toBe('member');
  });

  it('a legacy org: every org member, the guest too', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'legacy', members: people });
    expect((await readMembers(cluster.client, org, SOURCE)).people).toEqual(['acct-me', 'acct-bob', 'acct-cy', 'acct-gus']);
  });
});

describe('Remove', () => {
  it('apps kept apart: out of Mero Issue Tracker (its team), never out of the organization', async () => {
    const { cluster, org } = await workspace({ 'acct-bob': 'member' });
    cluster.keepAppsApart(org);
    const roles = await removeWithHook(cluster, org, 'acct-bob');
    expect(roles.appOnly).toBe(true);
    expect(cluster.callsOf('removeTeamMember')[0]!.slice(0, 3)).toEqual([org, cluster.teamOf(org, PKG), 'acct-bob']);
    expect(cluster.callsOf('removeMember')).toEqual([]);
    expect(cluster.org(org).members['acct-bob']).toBe('member');
  });

  it('standalone: out of the organization, as before (the org is everyone\'s apps)', async () => {
    const { cluster, org } = await workspace({ 'acct-bob': 'member' });
    await removeWithHook(cluster, org, 'acct-bob');
    expect(cluster.org(org).members['acct-bob']).toBeUndefined();
    expect(cluster.callsOf('removeTeamMember')).toEqual([]);
  });

  it('a legacy org: out of the organization', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'legacy', members: { 'acct-bob': 'member' } });
    await removeWithHook(cluster, org, 'acct-bob');
    expect(cluster.org(org).members['acct-bob']).toBeUndefined();
  });
});

describe('adding Mero Issue Tracker to an organization whose apps have teams', () => {
  it('an admin of an open org: the team is made open, the other app\'s left open', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'standalone', role: 'admin' });
    const app = await addRepo(cluster.client, SOURCE, org, 'Main', '', passkey);
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    expect(cluster.modeOf(org)).toBe('standalone');
    expect(cluster.state.apps.get(app)!.access).toEqual({ kind: 'team', team: cluster.teamOf(org, PKG) });
  });

  it('an admin of an org that keeps its apps apart: the team is made closed, like the others', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'shared', role: 'admin' });
    await addRepo(cluster.client, SOURCE, org, 'Main', '', passkey);
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
    expect(cluster.modeOf(org)).toBe('shared');
  });

  it('a member is told only owners and admins can add it, and nothing is made', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'standalone', role: 'member' });
    await expect(addRepo(cluster.client, SOURCE, org, 'Main', '', passkey)).rejects.toThrow(
      /owners and admins can add Mero Issue Tracker/,
    );
    expect(cluster.callsOf('scopeApps')).toEqual([]);
    expect(cluster.callsOf('createApp')).toEqual([]);
  });

  it('a legacy org keeps organization access: nothing is converted from here', async () => {
    const cluster = orgCluster();
    const org = cluster.addOrg({ mode: 'legacy' });
    await addRepo(cluster.client, SOURCE, org, 'Main', '', passkey);
    expect(cluster.callsOf('scopeApps')).toEqual([]);
    expect(cluster.callsOf('createApp')[0]![2]).toEqual({ org });
  });
});
