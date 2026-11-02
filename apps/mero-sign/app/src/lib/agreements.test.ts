import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_KIND,
  createAgreement,
  createWorkspace,
  enterAgreement,
  ensureLibrary,
  listAgreements,
  listWorkspaces,
  pickInvitedAgreement,
} from './agreements';
import { fakeConn } from '../test/fakeClient';

const app = (appId: string, org: string | null, owner = 'acct-me') => ({
  appId,
  name: appId,
  owner,
  org,
  bundle: 'bundle-hash',
  package: null,
  version: null,
});

describe('workspaces are orgs', () => {
  it('lists the marked orgs and the orgs holding an agreement, not others', async () => {
    const conn = fakeConn();
    conn.fake.me.mockResolvedValue({
      orgs: [
        { orgId: 'org-a', name: 'Acme', role: 'owner' },
        { orgId: 'org-b', name: 'Other app', role: 'member' },
        { orgId: 'org-c', name: 'Joined', role: 'member' },
      ],
    });
    conn.fake.getOrg.mockImplementation(async (org: string) => ({
      name: org,
      members: { 'acct-me': 'owner', 'acct-x': 'member' },
      metadata: org === 'org-a' ? { kind: WORKSPACE_KIND } : null,
    }));
    conn.fake.listApps.mockResolvedValue([app('app-1', 'org-c')]);
    const rows = await listWorkspaces(conn);
    expect(rows.map((r) => [r.namespaceId, r.agreementCount, r.memberCount])).toEqual([
      ['org-a', 0, 2],
      ['org-c', 1, 2],
    ]);
    expect(conn.fake.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' });
  });

  it('creates an org marked as a workspace', async () => {
    const conn = fakeConn();
    expect(await createWorkspace(conn, 'Acme')).toEqual({ namespaceId: 'org-new' });
    expect(conn.fake.setOrgMetadata).toHaveBeenCalledWith('org-new', { kind: WORKSPACE_KIND, name: 'Acme' });
  });
});

describe('agreements are app instances in the org', () => {
  it('creates the instance in the org, then sets it up as an agreement', async () => {
    const conn = fakeConn({ setup: null });
    conn.fake.createApp.mockResolvedValue('app-nda');
    expect(await createAgreement(conn, { namespaceId: 'org-a', name: 'NDA' })).toEqual({
      agreementId: 'app-nda',
      contextId: 'app-nda',
    });
    expect(conn.fake.createApp).toHaveBeenCalledWith('NDA', 'bundle-hash', { org: 'org-a' });
    expect(conn.fake.call).toHaveBeenCalledWith('app-nda', 'setup', { isPrivate: false, contextName: 'NDA' });
  });

  it("lists the org's instances with their participants", async () => {
    const conn = fakeConn({
      getContextDetails: (_a: Record<string, unknown>, id: string) => ({
        contextName: `Name of ${id}`,
        participants: id === 'app-1' ? [{ userId: 'acct-me', permissionLevel: 'Admin' }] : [],
      }),
    });
    conn.fake.listApps.mockResolvedValue([app('app-2', 'org-a'), app('app-1', 'org-a'), app('app-9', 'org-z')]);
    const rows = await listAgreements(conn, 'org-a');
    expect(rows.map((r) => [r.contextId, r.name, r.joined, r.memberCount])).toEqual([
      ['app-1', 'Name of app-1', true, 1],
      ['app-2', 'Name of app-2', false, 0],
    ]);
  });

  it('enters by registering, once', async () => {
    const refused = Object.assign(new Error('not found'), { appCode: 'NotFound' });
    const conn = fakeConn({ getUserPermission: refused, registerSelfAsParticipant: null });
    await enterAgreement(conn, { contextId: 'app-1' });
    expect(conn.fake.call).toHaveBeenCalledWith('app-1', 'registerSelfAsParticipant', {});

    const member = fakeConn({ getUserPermission: 'Sign' });
    await enterAgreement(member, { contextId: 'app-1' });
    expect(member.fake.call).not.toHaveBeenCalled();
  });

  it('picks the hinted agreement only when it is in the workspace', () => {
    const rows = [{ contextId: 'a' }, { contextId: 'b' }];
    expect(pickInvitedAgreement(rows, 'b')).toEqual({ contextId: 'b' });
    expect(pickInvitedAgreement(rows, 'elsewhere')).toBeNull();
    expect(pickInvitedAgreement([{ contextId: 'a' }], undefined)).toEqual({ contextId: 'a' });
  });
});

describe('the personal library', () => {
  it('reuses the library this account owns', async () => {
    const conn = fakeConn({
      isDefaultPrivateContext: (_a: Record<string, unknown>, id: string) => id === 'app-lib',
    });
    conn.fake.listApps.mockResolvedValue([
      app('app-agreement', 'org-a'),
      app('app-theirs', null, 'acct-other'),
      app('app-lib', null),
    ]);
    expect(await ensureLibrary(conn)).toBe('app-lib');
    expect(conn.fake.createApp).not.toHaveBeenCalled();
  });
});
