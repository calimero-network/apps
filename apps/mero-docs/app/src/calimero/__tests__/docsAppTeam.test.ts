/**
 * Docs' own app team (core#4890), against the shared in-memory cluster
 * (`@calimero-apps/connect/testing`), the way mero-chat's `chatAppTeam.test.ts`
 * pins Chat's: a new workspace gets an open team and its registry goes on it;
 * app teams are not folders; invites name the team; the member list is its
 * people; Remove and Leave in an org that keeps its apps apart keep the person
 * in the org; a legacy org works as before.
 */
import { describe, expect, it } from 'vitest';
import type { PasskeyProvider } from '@calimero-network/mero-js';
import { orgCluster } from '@calimero-apps/connect/testing';

import { OrgAdmin } from '../orgs';
import { foldersOf } from '@/lib/coreFolders';

const PKG = 'com.calimero.mero-drive-docs';
const SOURCE = { package: PKG };
const passkey = {} as PasskeyProvider;

function docs(cluster = orgCluster()) {
  return { cluster, admin: new OrgAdmin(cluster.client, cluster.state.me, () => passkey, SOURCE) };
}

async function workspace(people: Record<string, string> = {}) {
  const { cluster, admin } = docs();
  const { namespaceId: org } = await admin.createNamespace({ name: 'Acme' });
  Object.assign(cluster.org(org).members, people);
  return { cluster, admin, org };
}

const ids = (rows: { members: Array<{ identity: string }> }) => rows.members.map((m) => m.identity);

describe('a new workspace gets Docs\' own app team', () => {
  it('open (standalone), made with `shared: false`; the registry is on it', async () => {
    const { cluster, admin, org } = await workspace();
    expect(cluster.modeOf(org)).toBe('standalone');
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    const { contextId } = await admin.createContext({ groupId: org, name: 'Registry' });
    expect(cluster.state.apps.get(contextId)!.access).toEqual({ kind: 'team', team: cluster.teamOf(org, PKG) });
  });

  it('the app team is not a folder; folders made after it are', async () => {
    const { admin, org } = await workspace();
    const { groupId } = await admin.createGroupInNamespace(org, { name: 'Eng', parentId: org });
    expect((await admin.listSubgroups(org)).map((g) => g.groupId)).toEqual([groupId]);
    expect(foldersOf(await admin.org(org, true)).map((f) => f.id)).toEqual([groupId]);
  });

  it('a declined team leaves a legacy workspace, whose registry uses organization access', async () => {
    const { cluster, admin } = docs();
    cluster.state.declined.add('scopeApps');
    const { namespaceId: org } = await admin.createNamespace({ name: 'Acme' });
    expect(cluster.modeOf(org)).toBe('legacy');
    const { contextId } = await admin.createContext({ groupId: org, name: 'Registry' });
    expect(cluster.state.apps.get(contextId)!.access).toEqual({ kind: 'org' });
  });
});

describe('invites name Docs\' team', () => {
  it('standalone: the workspace invite names it, not app-only', async () => {
    const { cluster, admin, org } = await workspace();
    expect((await admin.createNamespaceInvitation(org)).appOnly).toBe(false);
    expect(cluster.callsOf('invite')[0]![3]).toEqual([cluster.teamOf(org, PKG)]);
  });

  it('apps kept apart: Docs only; a folder invite names Docs\' team and the folder\'s', async () => {
    const { cluster, admin, org } = await workspace();
    const { groupId } = await admin.createGroupInNamespace(org, { name: 'Eng', parentId: org, visibility: 'restricted' });
    cluster.keepAppsApart(org);
    expect((await admin.createNamespaceInvitation(org)).appOnly).toBe(true);
    const folder = await admin.createGroupInvitation(groupId);
    expect(folder).toMatchObject({ namespaceId: org, appOnly: true });
    expect(cluster.callsOf('invite')[1]![3]).toEqual([cluster.teamOf(org, PKG), groupId]);
  });

  it('a legacy org: the org-wide invite, as before', async () => {
    const { cluster, admin } = docs();
    const org = cluster.addOrg({ mode: 'legacy' });
    expect(await admin.createNamespaceInvitation(org)).toEqual({ token: expect.any(String), appOnly: false });
    expect(cluster.callsOf('invite')[0]![3]).toBeUndefined();
  });
});

describe('the workspace\'s people are Docs\'', () => {
  const people = { 'acct-bob': 'member', 'acct-cy': 'member', 'acct-gus': 'guest' };

  it('standalone: every member, not a guest without a row', async () => {
    const { admin, org } = await workspace(people);
    expect(ids(await admin.listGroupMembers(org))).toEqual(['acct-me', 'acct-bob', 'acct-cy']);
    expect((await admin.getGroupInfo(org)).memberCount).toBe(3);
  });

  it('apps kept apart: only the people in Docs', async () => {
    const { cluster, admin, org } = await workspace(people);
    cluster.keepAppsApart(org, { [cluster.teamOf(org, PKG)!]: ['acct-me', 'acct-bob'] });
    expect(ids(await admin.listGroupMembers(org))).toEqual(['acct-me', 'acct-bob']);
  });

  it('a legacy org: every org member, the guest too', async () => {
    const { cluster, admin } = docs();
    const org = cluster.addOrg({ mode: 'legacy', members: people });
    expect(ids(await admin.listGroupMembers(org))).toEqual(['acct-me', 'acct-bob', 'acct-cy', 'acct-gus']);
  });
});

describe('Remove and Leave', () => {
  it('apps kept apart: Remove takes the person out of Docs, never the org', async () => {
    const { cluster, admin, org } = await workspace({ 'acct-bob': 'member' });
    cluster.keepAppsApart(org);
    await admin.removeGroupMembers(org, { members: ['acct-bob'] });
    expect(cluster.callsOf('removeTeamMember')[0]!.slice(0, 3)).toEqual([org, cluster.teamOf(org, PKG), 'acct-bob']);
    expect(cluster.org(org).members['acct-bob']).toBe('member');
  });

  it('standalone and legacy: Remove is out of the organization, as before', async () => {
    const { cluster, admin, org } = await workspace({ 'acct-bob': 'member' });
    await admin.removeGroupMembers(org, { members: ['acct-bob'] });
    expect(cluster.org(org).members['acct-bob']).toBeUndefined();
    const legacy = cluster.addOrg({ mode: 'legacy', members: { 'acct-bob': 'member' } });
    await admin.removeGroupMembers(legacy, { members: ['acct-bob'] });
    expect(cluster.org(legacy).members['acct-bob']).toBeUndefined();
  });

  it('a folder row is removed from the folder only; an app team is refused there', async () => {
    const { cluster, admin, org } = await workspace({ 'acct-bob': 'member' });
    const { groupId } = await admin.createGroupInNamespace(org, { name: 'Eng', parentId: org, visibility: 'restricted' });
    await admin.addGroupMembers(groupId, { members: [{ identity: 'acct-bob' }] });
    await admin.removeGroupMembers(groupId, { members: ['acct-bob'] });
    expect(cluster.org(org).teams[groupId]!.members['acct-bob']).toBeUndefined();
    expect(cluster.org(org).members['acct-bob']).toBe('member');
  });

  it('apps kept apart: Leave is Docs only, and says when it was the last app there', async () => {
    const { cluster, admin, org } = await workspace({ 'acct-ana': 'owner' });
    cluster.keepAppsApart(org);
    cluster.org(org).members['acct-me'] = 'member';
    expect(await admin.leaveNamespace(org)).toEqual({ left: 'app', lastApp: true });
    expect(cluster.org(org).members['acct-me']).toBe('member');
    await admin.leaveOrganization(org);
    expect(cluster.org(org).members['acct-me']).toBeUndefined();
  });

  it('standalone: Leave is leaving the organization', async () => {
    const { cluster, admin, org } = await workspace({ 'acct-ana': 'owner' });
    expect(await admin.leaveNamespace(org)).toEqual({ left: 'org', lastApp: false });
    expect(cluster.org(org).members['acct-me']).toBeUndefined();
  });
});

describe('adding Docs to an organization whose apps have teams', () => {
  it('an admin of an open org: Docs\' team is made open', async () => {
    const { cluster, admin } = docs();
    const org = cluster.addOrg({ mode: 'standalone', role: 'admin' });
    await admin.createContext({ groupId: org, name: 'Registry' });
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: false });
    expect(cluster.modeOf(org)).toBe('standalone');
  });

  it('an admin of an org that keeps its apps apart: made closed', async () => {
    const { cluster, admin } = docs();
    const org = cluster.addOrg({ mode: 'shared', role: 'admin' });
    await admin.createContext({ groupId: org, name: 'Registry' });
    expect(cluster.callsOf('scopeApps')[0]![2]).toEqual({ apps: [{ package: PKG }], shared: true });
  });

  it('a member is told only owners and admins can add it', async () => {
    const { cluster, admin } = docs();
    const org = cluster.addOrg({ mode: 'standalone', role: 'member' });
    await expect(admin.createContext({ groupId: org, name: 'Registry' })).rejects.toThrow(/owners and admins can add Mero Docs/);
    expect(cluster.callsOf('createApp')).toEqual([]);
  });
});
