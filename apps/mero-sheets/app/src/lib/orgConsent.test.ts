// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenConsentOptions, PasskeyProvider } from '@calimero-network/mero-js';
import { ConsentNotStarted, forgetBoundApp } from '@calimero-apps/connect';

const handoff = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@calimero-apps/passkey', () => ({ confirmConsentHandoff: handoff }));

import { ORG_CONSENT_KEY, returnFromConsent, setWorkspaceRole } from './orgConsent';

const passkey = () => ({}) as PasskeyProvider;

/** A client whose session is bound to `app` (`null`: unbound), able to open the consent page. */
function client(app: string | null) {
  const c = {
    session: { accountId: 'acct-me' },
    auth: { me: vi.fn(async () => ({ accountId: 'acct-me', app })) },
    orgs: { setMember: vi.fn(async () => ({})) },
    openConsentPage: vi.fn(async (_request: unknown, options?: OpenConsentOptions) => {
      const started = { requestId: 'req-1', url: 'https://node.example/consent/req-1', code: 'ABC-DEF' };
      await (options as { confirm?: (s: typeof started) => Promise<boolean> } | undefined)?.confirm?.(started);
      return started;
    }),
  };
  forgetBoundApp(c);
  return c;
}

async function stillPending(p: Promise<unknown>): Promise<boolean> {
  const tag = Symbol('pending');
  return (await Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(tag), 20))])) === tag;
}

beforeEach(() => {
  sessionStorage.clear();
  handoff.mockResolvedValue(true);
});
afterEach(() => vi.clearAllMocks());

describe('a workspace role', () => {
  it('from the app’s own frontend: on the consent page, never the refused direct call', async () => {
    const c = client('com.calimero.mero-sheets');
    const done = setWorkspaceRole(c as never, 'org-1', 'acct-bob', 'admin', passkey);
    expect(await stillPending(done)).toBe(true);
    expect(c.openConsentPage.mock.calls[0]![0]).toMatchObject({
      kind: 'setMemberRole',
      subject: { org: 'org-1', account: 'acct-bob', role: 'admin' },
    });
    expect(c.orgs.setMember).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(ORG_CONSENT_KEY)!)).toMatchObject({ kind: 'setMemberRole', account: 'acct-bob' });
  });

  it('staying: nothing is kept or changed', async () => {
    handoff.mockResolvedValue(false);
    const c = client('com.calimero.mero-sheets');
    await expect(setWorkspaceRole(c as never, 'org-1', 'acct-bob', 'admin', passkey)).rejects.toBeInstanceOf(ConsentNotStarted);
    expect(sessionStorage.getItem(ORG_CONSENT_KEY)).toBeNull();
    expect(c.orgs.setMember).not.toHaveBeenCalled();
  });

  it('an unbound session makes the call itself, as before', async () => {
    const c = client(null);
    await setWorkspaceRole(c as never, 'org-1', 'acct-bob', 'member', passkey);
    expect(c.openConsentPage).not.toHaveBeenCalled();
    expect(c.orgs.setMember.mock.calls[0]![0]).toEqual({ org: 'org-1', account: 'acct-bob', role: 'member' });
  });
});

describe('back from the consent page', () => {
  const RETURN = 'https://sheets.apps.example/app?request_id=req-1&result=approved';

  it('reads the decision on the role this tab asked for', async () => {
    sessionStorage.setItem(ORG_CONSENT_KEY, JSON.stringify({ kind: 'setMemberRole', org: 'org-1', account: 'acct-bob', role: 'admin' }));
    const resumeConsent = vi.fn(async () => ({ requestId: 'req-1', kind: 'setMemberRole', status: 'approved' }));
    expect(await returnFromConsent({ resumeConsent } as never, RETURN)).toEqual({
      kind: 'setMemberRole',
      approved: true,
      org: 'org-1',
      role: 'admin',
    });
    expect(sessionStorage.getItem(ORG_CONSENT_KEY)).toBeNull();
  });

  it('leaves a return it kept nothing for to the shared dialogs', async () => {
    const resumeConsent = vi.fn();
    expect(await returnFromConsent({ resumeConsent } as never, RETURN)).toBeNull();
    expect(await returnFromConsent({ resumeConsent } as never, 'https://sheets.apps.example/app')).toBeNull();
    expect(resumeConsent).not.toHaveBeenCalled();
  });
});
