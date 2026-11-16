/**
 * An org role from a session bound to Mero Pass's frontend goes to the node's
 * consent page (the node refuses it otherwise), with the shared handoff dialog
 * first; an unbound session makes the change itself. On return, what was
 * asked is said from the node's decision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentNotStarted, forgetBoundApp } from '@calimero-apps/connect';

const handoff = vi.hoisted(() => ({ answer: true }));
vi.mock('@calimero-apps/passkey', () => ({
  confirmConsentHandoff: vi.fn(async () => handoff.answer),
}));

import {
  ORG_CONSENT_KEY,
  askRoleConsent,
  keptRoleIntent,
  returnFromOrgConsent,
  type RoleConsentIntent,
} from './orgConsent';

const INTENT: RoleConsentIntent = {
  kind: 'setMemberRole',
  org: 'org-1',
  account: 'acct-bob',
  role: 'admin',
  name: 'Bob',
};

function client(app: string | null) {
  return {
    auth: { me: vi.fn(async () => ({ accountId: 'acct-me', app })) },
    openConsentPage: vi.fn(
      async (
        _request: unknown,
        options?: { confirm?: (s: { code: string }) => Promise<boolean> },
      ) => {
        await options?.confirm?.({ code: 'ABCD' });
        return { requestId: 'req-1', code: 'ABCD' };
      },
    ),
    resumeConsent: vi.fn(),
  };
}

beforeEach(() => {
  handoff.answer = true;
  sessionStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('askRoleConsent', () => {
  it('an unbound session makes the change itself', async () => {
    const c = client(null);
    expect(await askRoleConsent(c as never, INTENT)).toBe(false);
    expect(c.openConsentPage).not.toHaveBeenCalled();
    expect(keptRoleIntent()).toBeNull();
  });

  it('a bound session asks the consent page and keeps the intent', async () => {
    const c = client('com.calimero.mero-pass');
    expect(await askRoleConsent(c as never, INTENT)).toBe(true);
    expect(c.openConsentPage.mock.calls[0]![0]).toMatchObject({
      kind: 'setMemberRole',
      subject: { org: 'org-1', account: 'acct-bob', role: 'admin' },
    });
    expect(keptRoleIntent()).toEqual(INTENT);
    forgetBoundApp(c);
  });

  it('staying on Mero Pass changes nothing and keeps nothing', async () => {
    handoff.answer = false;
    const c = client('com.calimero.mero-pass');
    await expect(askRoleConsent(c as never, INTENT)).rejects.toBeInstanceOf(
      ConsentNotStarted,
    );
    expect(keptRoleIntent()).toBeNull();
  });
});

describe('returnFromOrgConsent', () => {
  const back =
    'https://pass.example/teams/org-1?tab=people&request_id=req-1&result=approved';

  it('not a consent return: nothing is read', async () => {
    const c = client(null);
    expect(
      await returnFromOrgConsent(
        c as never,
        'https://pass.example/teams/org-1',
      ),
    ).toBeNull();
    expect(c.resumeConsent).not.toHaveBeenCalled();
  });

  it('says the role change the node approved, once', async () => {
    sessionStorage.setItem(ORG_CONSENT_KEY, JSON.stringify(INTENT));
    const c = client(null);
    c.resumeConsent.mockResolvedValue({
      requestId: 'req-1',
      kind: 'setMemberRole',
      status: 'approved',
    });
    expect(await returnFromOrgConsent(c as never, back)).toEqual({
      ...INTENT,
      approved: true,
    });
    expect(keptRoleIntent()).toBeNull();
  });

  it('a declined request is said as not approved', async () => {
    sessionStorage.setItem(ORG_CONSENT_KEY, JSON.stringify(INTENT));
    const c = client(null);
    c.resumeConsent.mockResolvedValue({
      requestId: 'req-1',
      kind: 'setMemberRole',
      status: 'declined',
    });
    expect(await returnFromOrgConsent(c as never, back)).toMatchObject({
      approved: false,
    });
  });

  it('leaves a return it did not start to the screen that did', async () => {
    const c = client(null);
    expect(await returnFromOrgConsent(c as never, back)).toBeNull();
    expect(c.resumeConsent).not.toHaveBeenCalled();
  });
});
