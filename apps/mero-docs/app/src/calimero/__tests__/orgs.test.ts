import { describe, expect, it, vi } from 'vitest';
import type { CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';
import { OrgAdmin, parseOrg, teamMembers } from '../orgs';
import { foldersOf } from '@/lib/coreFolders';

// An org as `GET /orgs/{org}` answers it: alice owns it, bob is a member,
// gus a guest; "eng" is open under the org, "secret" restricted under eng,
// "ops" open under secret.
const RAW = {
  orgId: 'org-1',
  name: 'Acme',
  members: { alice: 'owner', bob: 'member', cy: 'member', gus: 'guest' },
  defaultCapabilities: 37,
  capabilities: { cy: 0 },
  metadata: { registryApp: 'reg-1' },
  memberMetadata: { bob: { name: 'Bob' } },
  teams: {
    eng: { teamId: 'eng', name: 'Engineering', join: 'everyone', members: {}, readOnly: [], capabilities: {}, metadata: { color: '#3b82f6', docsApp: 'docs-eng' }, removed: ['bob'] },
    secret: { teamId: 'secret', name: 'Secret', parent: 'eng', join: 'invite', members: { alice: true, dan: false }, readOnly: ['dan'], capabilities: { dan: 4 }, metadata: {}, removed: [] },
    ops: { teamId: 'ops', name: 'Ops', parent: 'secret', join: 'everyone', members: {}, readOnly: [], capabilities: {}, metadata: {}, removed: [] },
  },
};

function fakeClient() {
  const created: Record<string, unknown> = {};
  return {
    me: vi.fn(async () => ({ orgs: [{ orgId: 'org-1', name: 'Acme', role: 'owner' }, { orgId: 'org-2', name: 'Other' }] })),
    getOrg: vi.fn(async (org: string) =>
      org === 'org-1' ? { ...RAW, teams: { ...RAW.teams, ...created } } : { orgId: org, name: 'Other', members: {}, teams: {} },
    ),
    listApps: vi.fn(async () => [{ appId: 'reg-1', org: 'org-1', name: 'Registry', owner: 'alice', bundle: 'b', package: null, version: null }]),
    createTeam: vi.fn(async (_org: string, name: string, join: string, parent?: string) => {
      created['new-team'] = { teamId: 'new-team', name, join, parent, members: { alice: true }, metadata: {} };
      return 'new-team';
    }),
    updateTeam: vi.fn(async () => undefined),
    createApp: vi.fn(async () => 'app-9'),
    setOrgMetadata: vi.fn(async () => undefined),
    setTeamMember: vi.fn(async () => undefined),
    setMember: vi.fn(async () => undefined),
    setCapabilities: vi.fn(async () => undefined),
    removeTeamMember: vi.fn(async () => undefined),
    invite: vi.fn(async () => 'inv_token'),
    redeemInvite: vi.fn(async () => ({ orgId: 'org-1' })),
    uploadBlob: vi.fn(async () => ({ blobId: 'b58', id: 'a'.repeat(64), size: 3 })),
  };
}

const passkey = {} as PasskeyProvider;
function admin(client = fakeClient()) {
  return { client, admin: new OrgAdmin(client as unknown as CalimeroClient, 'alice', () => passkey, 'bundle-hash') };
}

describe('teamMembers', () => {
  const org = parseOrg('org-1', RAW);

  it('lets everyone who reaches the parent into an open team, guests, removed members and those denied JOIN aside', () => {
    expect(Object.fromEntries(teamMembers(org, 'eng'))).toEqual({ alice: 'Admin' });
  });

  it('holds a restricted team to its direct rows, lead as Admin and read-only as ReadOnly', () => {
    expect(Object.fromEntries(teamMembers(org, 'secret'))).toEqual({ alice: 'Admin', dan: 'ReadOnly' });
  });

  it('flows through an open team under a restricted one', () => {
    expect([...teamMembers(org, 'ops').keys()].sort()).toEqual(['alice', 'dan']);
  });
});

describe('foldersOf', () => {
  it('reads each team as a folder: name, colour, docs instance, own and effective visibility', () => {
    const folders = foldersOf(parseOrg('org-1', RAW));
    expect(folders.find((f) => f.id === 'eng')).toEqual({
      id: 'eng',
      parent_id: null,
      color: '#3b82f6',
      alias: 'Engineering',
      context_id: 'docs-eng',
      visibility: 'Open',
      effectiveVisibility: 'Open',
      shared: false,
    });
    expect(folders.find((f) => f.id === 'ops')).toMatchObject({ parent_id: 'secret', visibility: 'Open', effectiveVisibility: 'Restricted' });
  });

  it('marks a folder whose parent the caller cannot see as shared, at the top', () => {
    const { eng: _eng, ...teams } = RAW.teams;
    const folders = foldersOf(parseOrg('org-1', { ...RAW, teams }));
    expect(folders.find((f) => f.id === 'secret')).toMatchObject({ parent_id: null, shared: true });
  });
});

describe('OrgAdmin', () => {
  it('lists the workspaces: orgs holding an instance of this app, with their member counts', async () => {
    const { admin: a } = admin();
    expect(await a.listNamespaces()).toEqual([{ namespaceId: 'org-1', name: 'Acme', role: 'owner', memberCount: 4 }]);
  });

  it('answers member rows with names and v1 roles, for the org and a team', async () => {
    const { admin: a } = admin();
    expect((await a.listGroupMembers('org-1')).members).toEqual([
      { identity: 'alice', role: 'Admin' },
      { identity: 'bob', role: 'Member', name: 'Bob' },
      { identity: 'cy', role: 'Member' },
      { identity: 'gus', role: 'ReadOnly' },
    ]);
    expect((await a.listGroupMembers('secret')).members).toEqual([
      { identity: 'alice', role: 'Admin' },
      { identity: 'dan', role: 'ReadOnly' },
    ]);
  });

  it('reads capabilities: org-wide with the default, a team row, an inherited Editor, and 404 for someone not there', async () => {
    const { admin: a } = admin();
    expect(await a.getMemberCapabilities('org-1', 'bob')).toEqual({ capabilities: 37 });
    expect(await a.getMemberCapabilities('org-1', 'cy')).toEqual({ capabilities: 0 });
    expect(await a.getMemberCapabilities('secret', 'dan')).toEqual({ capabilities: 4 });
    expect(await a.getMemberCapabilities('eng', 'alice')).toEqual({ capabilities: 4 });
    await expect(a.getMemberCapabilities('eng', 'bob')).rejects.toMatchObject({ status: 404 });
  });

  it('creates a folder as a team under its parent and pins its docs instance in the team metadata', async () => {
    const { admin: a, client } = admin();
    await a.org('org-1');
    const { groupId } = await a.createGroupInNamespace('org-1', { visibility: 'restricted', parentId: 'eng', name: 'Plans' });
    expect(client.createTeam).toHaveBeenCalledWith('org-1', 'Plans', 'invite', 'eng');
    const { contextId } = await a.createContext({ groupId, name: 'Plans' });
    expect(contextId).toBe('app-9');
    expect(client.createApp).toHaveBeenCalledWith('Plans', 'bundle-hash', {
      org: 'org-1',
      access: { kind: 'team', team: 'new-team' },
    });
    expect(client.updateTeam).toHaveBeenCalledWith('org-1', 'new-team', { metadata: { docsApp: 'app-9' } });
  });

  it('pins a workspace registry in the org metadata, keeping what is there', async () => {
    const { admin: a, client } = admin();
    await a.createContext({ groupId: 'org-1', name: 'Registry' });
    expect(client.createApp).toHaveBeenCalledWith('Registry', 'bundle-hash', { org: 'org-1', access: { kind: 'org' } });
    expect(client.setOrgMetadata).toHaveBeenCalledWith('org-1', { registryApp: 'app-9' });
  });

  it('writes folder roles as team rows, approved with the passkey', async () => {
    const { admin: a, client } = admin();
    await a.updateMemberRole('secret', 'dan', { role: 'ReadOnly' });
    expect(client.setTeamMember).toHaveBeenCalledWith('org-1', 'secret', 'dan', passkey, { role: 'readOnly' });
    await a.addGroupMembers('secret', { members: [{ identity: 'eve', role: 'Member' }] });
    expect(client.setTeamMember).toHaveBeenCalledWith('org-1', 'secret', 'eve', passkey, { role: 'member', capabilities: 4 });
    await a.setMemberCapabilities('org-1', 'bob', { capabilities: 0 });
    expect(client.setCapabilities).toHaveBeenCalledWith('org-1', 0, passkey, { account: 'bob' });
  });

  it('invites to a folder with an org invite naming its team', async () => {
    const { admin: a, client } = admin();
    expect(await a.createGroupInvitation('secret')).toEqual({ token: 'inv_token', namespaceId: 'org-1' });
    expect(client.invite).toHaveBeenCalledWith('org-1', 'member', passkey, ['secret']);
    expect(await a.redeemInvite('inv_token')).toBe('org-1');
  });

  it('keeps an uploaded image by its hex id', async () => {
    const { admin: a } = admin();
    expect(await a.uploadBlob({ data: new Uint8Array([1, 2, 3]), contextId: 'docs-eng' })).toEqual({ blobId: 'a'.repeat(64) });
  });
});
