/**
 * Organization-wide changes from a session bound to Docs' frontend go to the
 * node's consent page; an unbound session makes them itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasskeyProvider } from '@calimero-network/mero-js';
import { orgCluster } from '@calimero-apps/connect/testing';
import { OrgAdmin } from '../orgs';
import { CONSENT_INTENT_KEY, consentIntent, returnFromConsent, StayedInDocs } from '../consent';

const handoff = vi.hoisted(() => ({ answer: true }));
vi.mock('@calimero-apps/passkey', () => ({
  confirmConsentHandoff: vi.fn(async () => handoff.answer),
}));

const PKG = 'com.calimero.mero-drive-docs';
const passkey = {} as PasskeyProvider;

/** A workspace whose session is bound to Docs (`bound`) or not. */
async function workspace(bound: boolean) {
  const cluster = orgCluster();
  const raw = cluster.client as unknown as {
    auth: { me: () => Promise<unknown> };
    openConsentPage: ReturnType<typeof vi.fn>;
  };
  const me = raw.auth.me.bind(raw.auth);
  raw.auth.me = async () => ({ ...((await me()) as object), app: bound ? PKG : null });
  raw.openConsentPage = vi.fn(async (_request: unknown, options: { confirm: (s: { code: string }) => Promise<boolean> }) => {
    await options.confirm({ code: 'ABC-DEF' });
    return { requestId: 'req-1', code: 'ABC-DEF' };
  });
  const admin = new OrgAdmin(cluster.client, cluster.state.me, () => passkey, { package: PKG });
  const { orgId } = await cluster.client.orgs.create({ name: 'Acme' });
  await admin.finishNamespace(orgId);
  return { cluster, admin, org: orgId, open: raw.openConsentPage };
}

/** Whether `p` is still pending after a tick: the page is navigating. */
async function stillPending(p: Promise<unknown>): Promise<boolean> {
  const tag = Symbol('pending');
  const r = await Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(tag), 20))]);
  return r === tag;
}

beforeEach(() => {
  sessionStorage.clear();
  handoff.answer = true;
});

describe('a session bound to Docs', () => {
  it('deletes a workspace on the consent page, keeping what it was doing', async () => {
    const { cluster, admin, org, open } = await workspace(true);
    expect(await stillPending(admin.deleteNamespace(org))).toBe(true);
    expect(open.mock.calls[0]![0]).toMatchObject({ kind: 'deleteOrg', subject: { org } });
    expect(consentIntent()).toEqual({ kind: 'deleteOrg', org });
    expect(cluster.callsOf('deleteOrg')).toEqual([]);
  });

  it('sets member defaults and an organization role there', async () => {
    const { admin, org, open } = await workspace(true);
    void admin.setDefaultCapabilities(org, { defaultCapabilities: 5 });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0]![0]).toMatchObject({ kind: 'setCapabilities', subject: { org, capabilities: 5 } });
    void admin.updateMemberRole(org, 'acct-bob', { role: 'Admin' });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls[1]![0]).toMatchObject({
      kind: 'setMemberRole',
      subject: { org, account: 'acct-bob', role: 'admin' },
    });
  });

  it('keeps the permissions that come with a role, to ask for once the role is back', async () => {
    const { admin, org, open } = await workspace(true);
    void admin.updateMemberRole(org, 'acct-bob', { role: 'Member', thenCapabilities: 37 });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0]![0]).toMatchObject({ kind: 'setMemberRole', subject: { org, account: 'acct-bob', role: 'member' } });
    expect(open.mock.calls[0]![0]).not.toHaveProperty('then');
    expect(consentIntent()).toEqual({
      kind: 'setMemberRole',
      org,
      account: 'acct-bob',
      role: 'member',
      then: { kind: 'setCapabilities', org, account: 'acct-bob', capabilities: 37 },
    });
  });

  it('removes from Docs\' own team itself, without the consent page', async () => {
    const { cluster, admin, open } = await workspace(true);
    // As the consent page makes it: Docs' team in the same step.
    const org = cluster.addOrg({ mode: 'standalone', app: PKG, members: { 'acct-bob': 'member' } });
    await admin.removeGroupMembers(org, { members: ['acct-bob'] });
    expect(open).not.toHaveBeenCalled();
    expect(cluster.callsOf('removeTeamMember')[0]!.slice(0, 3)).toEqual([org, cluster.teamOf(org, PKG), 'acct-bob']);
    expect(cluster.org(org).members['acct-bob']).toBe('member');
  });

  it('changes nothing when the person stays', async () => {
    const { cluster, admin, org } = await workspace(true);
    handoff.answer = false;
    await expect(admin.deleteNamespace(org)).rejects.toBeInstanceOf(StayedInDocs);
    expect(sessionStorage.getItem(CONSENT_INTENT_KEY)).toBeNull();
    expect(cluster.callsOf('deleteOrg')).toEqual([]);
  });
});

describe('an unbound session', () => {
  it('deletes the workspace itself', async () => {
    const { cluster, admin, org, open } = await workspace(false);
    await admin.deleteNamespace(org);
    expect(open).not.toHaveBeenCalled();
    expect(cluster.callsOf('deleteOrg')).toHaveLength(1);
  });
});

describe('the return', () => {
  it('pairs the node\'s decision with the kept intent, and forgets it', async () => {
    sessionStorage.setItem(CONSENT_INTENT_KEY, JSON.stringify({ kind: 'leaveOrg', org: 'org-1' }));
    const back = await returnFromConsent({
      resumeConsent: async () => ({ kind: 'leaveOrg', status: 'approved' }),
    } as never);
    expect(back).toEqual({ intent: { kind: 'leaveOrg', org: 'org-1' }, kind: 'leaveOrg', approved: true });
    expect(consentIntent()).toBeNull();
  });

  it('is null on a page the consent page did not open', async () => {
    expect(await returnFromConsent({ resumeConsent: async () => null } as never)).toBeNull();
  });
});
