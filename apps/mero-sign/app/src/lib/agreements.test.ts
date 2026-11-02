import { describe, expect, it, vi } from 'vitest';
import { AppError, ORG_CAPABILITIES } from '@calimero-network/mero-js';

import {
  LIBRARY_NAME,
  MEMBER_DEFAULTS,
  createAgreement,
  createWorkspace,
  displayName,
  ensurePrivateLibrary,
  enterAgreement,
  listAgreements,
  listWorkspaces,
  pickInvitedAgreement,
} from './agreements';

const ME = 'acct-alice';
const app = (appId: string, name: string, org: string | null, owner = ME) => ({
  appId,
  name,
  org,
  owner,
  bundle: 'b',
  package: null,
  version: null,
});

/** A fake client: `apps` listed, every call/view recorded, views answered by `views`. */
function fake(
  apps: ReturnType<typeof app>[] = [],
  views: Record<string, unknown> = {},
) {
  const calls: { app: string; method: string; args: unknown }[] = [];
  let next = 0;
  return {
    calls,
    me: vi.fn(async () => ({
      orgs: [
        { orgId: 'org-b', name: 'Beta', role: 'member' },
        { orgId: 'org-a', name: 'Acme', role: 'owner' },
      ],
    })),
    getOrg: vi.fn(async () => ({
      name: 'Acme',
      members: { [ME]: 'owner', 'acct-bob': 'member' },
      memberMetadata: { 'acct-bob': { name: 'Bob' } },
    })),
    listApps: vi.fn(async () => apps),
    createApp: vi.fn(async () => `new-${++next}`),
    createOrg: vi.fn(async () => 'org-new'),
    setCapabilities: vi.fn(async () => undefined),
    call: vi.fn(async (a: string, method: string, args: unknown = {}) => {
      calls.push({ app: a, method, args });
      return { index: 1, result: null, events: [] };
    }),
    view: vi.fn(async (_a: string, method: string) => ({
      index: 1,
      result: views[method] ?? null,
    })),
  };
}

describe('workspaces', () => {
  it('are the orgs, with their agreement and member counts, by name', async () => {
    const c = fake([app('a1', 'NDA', 'org-a'), app('a2', 'SOW', 'org-a'), app('lib', LIBRARY_NAME, null)]);
    const rows = await listWorkspaces(c as never, 'bundle');
    expect(rows.map((r) => [r.name, r.agreementCount, r.memberCount])).toEqual([
      ['Acme', 2, 2],
      ['Beta', 0, 2],
    ]);
    expect(c.listApps).toHaveBeenCalledWith({ bundle: 'bundle' });
  });

  it('lists by package in production', async () => {
    const c = fake();
    await listWorkspaces(c as never, { package: 'com.calimero.mero-sign' });
    expect(c.listApps).toHaveBeenCalledWith({ package: 'com.calimero.mero-sign' });
  });

  it('a new one lets members create agreements and invite', async () => {
    const c = fake();
    const passkey = { create: vi.fn(), get: vi.fn() };
    const res = await createWorkspace(c as never, 'Acme', () => passkey);
    expect(res).toEqual({ namespaceId: 'org-new', warning: null });
    expect(c.setCapabilities).toHaveBeenCalledWith('org-new', MEMBER_DEFAULTS, passkey);
    expect(MEMBER_DEFAULTS & ORG_CAPABILITIES.CREATE_APP).toBeTruthy();
    expect(MEMBER_DEFAULTS & ORG_CAPABILITIES.INVITE_MEMBERS).toBeTruthy();
  });

  it('keeps the workspace when the capability step-up is declined, and says so', async () => {
    const c = fake();
    c.setCapabilities.mockRejectedValueOnce(new Error('cancelled'));
    const res = await createWorkspace(c as never, 'Acme', () => ({}) as never);
    expect(res.namespaceId).toBe('org-new');
    expect(res.warning).toMatch(/will not be able to create agreements/);
  });
});

describe('the private library', () => {
  it('is created once, outside any org, and set up as the default private context', async () => {
    const c = fake();
    const id = await ensurePrivateLibrary(c as never, 'bundle', ME);
    expect(id).toBe('new-1');
    expect(c.createApp).toHaveBeenCalledWith(LIBRARY_NAME, 'bundle');
    expect(c.calls).toEqual([
      { app: 'new-1', method: 'setup', args: { isPrivate: true, contextName: 'default' } },
    ]);
  });

  it('is found again, and never someone else’s', async () => {
    const c = fake(
      [app('theirs', LIBRARY_NAME, null, 'acct-bob'), app('mine', LIBRARY_NAME, null)],
      { isDefaultPrivateContext: true },
    );
    expect(await ensurePrivateLibrary(c as never, 'bundle', ME)).toBe('mine');
    expect(c.createApp).not.toHaveBeenCalled();
    expect(c.calls).toEqual([]);
  });
});

describe('agreements', () => {
  it('are the instances in the workspace, with their roster', async () => {
    const c = fake(
      [app('a2', 'SOW', 'org-a'), app('a1', 'NDA', 'org-a'), app('x', 'Other', 'org-b')],
      { listParticipants: [ME, 'acct-bob'] },
    );
    const rows = await listAgreements(c as never, 'bundle', 'org-a', ME);
    expect(rows.map((r) => [r.name, r.contextId, r.memberCount, r.joined])).toEqual([
      ['NDA', 'a1', 2, true],
      ['SOW', 'a2', 2, true],
    ]);
  });

  it('a new one is created in the org, set up shared, and recorded in the library', async () => {
    const c = fake([], { isDefaultPrivateContext: true });
    const id = await createAgreement(c as never, {
      source: 'bundle',
      org: 'org-a',
      name: 'NDA',
      accountId: ME,
    });
    expect(id).toBe('new-1');
    expect(c.createApp).toHaveBeenNthCalledWith(1, 'NDA', 'bundle', { org: 'org-a' });
    expect(c.calls[0]).toEqual({
      app: 'new-1',
      method: 'setup',
      args: { isPrivate: false, contextName: 'NDA' },
    });
    expect(c.calls.at(-1)).toEqual({
      app: 'new-2',
      method: 'joinSharedContext',
      args: { contextIdStr: 'new-1', sharedIdentityStr: ME, contextName: 'NDA' },
    });
  });

  it('entering one registers a member who is not on the roster yet', async () => {
    const c = fake([app('lib', LIBRARY_NAME, null)], {
      listParticipants: ['acct-bob'],
      isDefaultPrivateContext: true,
    });
    await enterAgreement(c as never, { source: 'bundle', appId: 'a1', accountId: ME, name: 'NDA' });
    expect(c.calls.map((x) => [x.app, x.method])).toEqual([
      ['a1', 'registerSelfAsParticipant'],
      ['lib', 'joinSharedContext'],
    ]);
  });

  it('entering one you are on changes nothing', async () => {
    const c = fake([], { listParticipants: [ME] });
    await enterAgreement(c as never, { source: 'bundle', appId: 'a1', accountId: ME, name: 'NDA' });
    expect(c.calls).toEqual([]);
  });

  it('a guest still opens it to read', async () => {
    const c = fake([], { listParticipants: [] });
    c.call.mockRejectedValueOnce(new AppError('refused', { code: 'Forbidden', message: '{}' }));
    await expect(
      enterAgreement(c as never, { source: 'bundle', appId: 'a1', accountId: ME, name: 'NDA' }),
    ).resolves.toBe(ME);
  });
});

describe('displayName and pickInvitedAgreement', () => {
  it('names, or a short id', () => {
    expect(displayName(['', ' NDA '], 'abcdef0123', 'Agreement')).toBe('NDA');
    expect(displayName([null], 'abcdef0123', 'Agreement')).toBe('Agreement abcdef01…');
  });

  it('honours the hinted agreement only when it is in the workspace', () => {
    const rows = [{ contextId: 'a1' }, { contextId: 'a2' }];
    expect(pickInvitedAgreement(rows, 'a2')).toEqual({ contextId: 'a2' });
    expect(pickInvitedAgreement(rows, 'zz')).toBeNull();
    expect(pickInvitedAgreement([{ contextId: 'a1' }], null)).toEqual({ contextId: 'a1' });
  });
});
