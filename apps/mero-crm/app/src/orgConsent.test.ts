// @vitest-environment jsdom
/**
 * Organization-wide changes on a session bound to the app's frontend go to the
 * node's consent page (the node refuses them from here); an unbound session
 * makes them itself. Back from the page, the app says what came of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasskeyProvider } from '@calimero-network/mero-js';
import { ConsentNotStarted, APP_CONSENT_INTENT_KEY, forgetBoundApp } from '@calimero-apps/connect';

const handoff = vi.fn(async (_o: { code: string; action?: string }) => true);
vi.mock('@calimero-apps/passkey', () => ({ confirmConsentHandoff: (o: { code: string }) => handoff(o) }));

const { finishOrgConsent, setOrgCapabilities, setOrgRole } = await import('./orgConsent');

const passkey = () => ({}) as PasskeyProvider;
const STARTED = { requestId: 'req-1', url: 'https://node/consent/req-1', code: 'ABC-DEF', expiresAt: 0 };

function fakeClient(bound: boolean) {
  const client = {
    session: { accountId: 'acct-me' },
    auth: { me: vi.fn(async () => (bound ? { app: 'com.calimero.mero-crm' } : {})) },
    orgs: { setMember: vi.fn(async () => ({})), capabilities: vi.fn(async () => ({})) },
    openConsentPage: vi.fn(
      async (_req: unknown, o?: { confirm?: (s: typeof STARTED) => boolean | Promise<boolean> }) => {
        await o?.confirm?.(STARTED);
        return STARTED;
      },
    ),
  };
  return client;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  handoff.mockClear();
  handoff.mockResolvedValue(true);
});
afterEach(() => sessionStorage.clear());

describe('an organization role', () => {
  it('bound: asked on the consent page, never set from here', async () => {
    const client = fakeClient(true);
    void setOrgRole(client as never, 'org-1', 'acct-bob', 'admin', passkey);
    await vi.waitFor(() => expect(client.openConsentPage).toHaveBeenCalledTimes(1));
    expect(client.openConsentPage.mock.calls[0]![0]).toMatchObject({
      kind: 'setMemberRole',
      subject: { org: 'org-1', account: 'acct-bob', role: 'admin' },
    });
    expect(handoff.mock.calls[0]![0]).toMatchObject({ code: 'ABC-DEF' });
    expect(client.orgs.setMember).not.toHaveBeenCalled();
    forgetBoundApp(client);
  });

  it('bound, declined: nothing changes and nothing is kept', async () => {
    const client = fakeClient(true);
    handoff.mockResolvedValue(false);
    await expect(setOrgRole(client as never, 'org-1', 'acct-bob', 'member', passkey)).rejects.toBeInstanceOf(
      ConsentNotStarted,
    );
    expect(client.orgs.setMember).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('unbound: set here, as before', async () => {
    const client = fakeClient(false);
    await setOrgRole(client as never, 'org-1', 'acct-bob', 'admin', passkey);
    expect(client.orgs.setMember).toHaveBeenCalledWith(
      { org: 'org-1', account: 'acct-bob', role: 'admin' },
      expect.anything(),
    );
    expect(client.openConsentPage).not.toHaveBeenCalled();
  });
});

describe('permissions', () => {
  it('bound: a member\'s mask and the defaults are asked on the consent page', async () => {
    const client = fakeClient(true);
    void setOrgCapabilities(client as never, 'org-1', 5, passkey, 'acct-bob');
    await vi.waitFor(() => expect(client.openConsentPage).toHaveBeenCalledTimes(1));
    expect(client.openConsentPage.mock.calls[0]![0]).toMatchObject({
      kind: 'setCapabilities',
      subject: { org: 'org-1', account: 'acct-bob', capabilities: 5 },
    });
    void setOrgCapabilities(client as never, 'org-1', 7, passkey);
    await vi.waitFor(() => expect(client.openConsentPage).toHaveBeenCalledTimes(2));
    expect(client.openConsentPage.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ kind: 'setCapabilities', subject: { org: 'org-1', capabilities: 7 } }),
    );
    expect(client.orgs.capabilities).not.toHaveBeenCalled();
  });

  it('unbound: set here', async () => {
    const client = fakeClient(false);
    await setOrgCapabilities(client as never, 'org-1', 7, passkey);
    expect(client.orgs.capabilities).toHaveBeenCalledWith({ org: 'org-1', capabilities: 7 }, expect.anything());
  });
});

describe('back from the consent page', () => {
  const RETURN = 'https://crm.example/?request_id=req-1&result=approved';

  it('a role change approved: said', async () => {
    const client = fakeClient(true);
    void setOrgRole(client as never, 'org-1', 'acct-bob', 'admin', passkey);
    await settle();
    const resumeConsent = vi.fn(async () => ({ requestId: 'req-1', kind: 'setMemberRole', status: 'approved' }));
    const notice = await finishOrgConsent({ resumeConsent } as never, RETURN);
    expect(notice).toEqual({ variant: 'success', description: 'They are now an admin of this workspace.' });
    forgetBoundApp(client);
  });

  it('a removal declined: nothing was changed', async () => {
    sessionStorage.setItem(APP_CONSENT_INTENT_KEY, JSON.stringify({ kind: 'removeMember', org: 'org-1', account: 'b' }));
    const resumeConsent = vi.fn(async () => ({ requestId: 'req-1', kind: 'removeMember', status: 'declined' }));
    expect(await finishOrgConsent({ resumeConsent } as never, RETURN)).toEqual({
      variant: 'info',
      description: 'Not approved. Nothing was changed.',
    });
  });

  it('another dialog\'s return, or none: left alone', async () => {
    const resumeConsent = vi.fn();
    expect(await finishOrgConsent({ resumeConsent } as never, RETURN)).toBeNull();
    expect(await finishOrgConsent({ resumeConsent } as never, 'https://crm.example/')).toBeNull();
    expect(resumeConsent).not.toHaveBeenCalled();
  });
});
