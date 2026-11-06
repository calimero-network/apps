import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalimeroError, type CalimeroClient, type CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import type { SessionDeps } from './session';
import { APP } from './session';
import { writeActiveNs } from './hooks/workspacePersistence';

const SESSION: CalimeroSession = { accountId: 'acct-alice', sessionToken: 's', refreshToken: 'r', expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };

const STAGES = [
  { id: 'stage-lead', name: 'Lead in', probability: 10, position: 0 },
  { id: 'stage-qualified', name: 'Qualified', probability: 25, position: 1 },
];

/** A deal as the contract answers it: v1's snake_case fields, u64s as decimal strings. */
const DEAL = {
  id: 'deal-1700000000000-aabbccdd',
  title: 'Acme 50 seats',
  value: '24000',
  organization: 'Acme',
  contact_id: null,
  contact_name: null,
  owner: 'acct-alice',
  stage_id: 'stage-lead',
  status: 'open',
  lost_reason: '',
  expected_close: null,
  source: 'Referral',
  probability: 10,
  stage_entered_at: String(Date.now()),
  closed_at: null,
  next_activity: null,
  open_activities: 0,
  last_touch_at: null,
  created_by: 'acct-alice',
  created_at: String(Date.now()),
};

function fakeClient(opts: { signedIn?: boolean } = {}) {
  let session: CalimeroSession | undefined = opts.signedIn ? SESSION : undefined;
  const views: Record<string, unknown> = {
    listStages: STAGES,
    listDeals: [DEAL],
    listContacts: [],
    listActivities: [],
    listAutomations: [],
    getSettings: { currency: 'USD', rotting_days: 14 },
  };
  const client = {
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signUp: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    me: vi.fn(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'org-1', name: 'Platform', role: 'owner' }] })),
    getOrg: vi.fn(async () => ({
      members: { 'acct-alice': 'owner', 'acct-bob': 'member' },
      memberMetadata: { 'acct-alice': { name: 'Alice' }, 'acct-bob': { name: 'Bob' } },
      capabilities: {},
      defaultCapabilities: 3,
    })),
    listApps: vi.fn(async () => [
      { appId: 'app-1', name: 'New business', owner: 'acct-alice', org: 'org-1', bundle: 'bundle-hash', package: null, version: null },
      { appId: 'app-x', name: 'elsewhere', owner: 'acct-alice', org: 'org-2', bundle: 'bundle-hash', package: null, version: null },
    ]),
    createOrg: vi.fn(async () => 'org-new'),
    setCapabilities: vi.fn(async () => {}),
    createApp: vi.fn(async () => 'app-new'),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: views[method] ?? null })),
    events: vi.fn(async function* () {}),
    invite: vi.fn(async () => 'tok-123'),
    redeemInvite: vi.fn(async () => ({ org: 'org-1' })),
    setMemberMetadata: vi.fn(async () => {}),
  };
  return client;
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as never,
  };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(cleanup);

// Each screen here waits on a chain of mocked requests (session -> /me ->
// listApps -> views); under a parallel workspace run that takes longer than
// testing-library's 1 s default.
const SLOW = { timeout: 10_000 };

function storeSession() {
  new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
}

describe('App', () => {
  it('signs in with a passkey from the landing page', async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    const connect = await screen.findAllByRole('button', { name: /sign in|connect|get started|open/i }, SLOW);
    fireEvent.click(connect[0]);
    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
  });

  it('opens the remembered workspace on its first pipeline and shows its deals', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
    // Only this workspace's pipelines, and the board read from the open one.
    expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' });
    expect(screen.queryByText('elsewhere')).toBeNull();
    expect(client.view).toHaveBeenCalledWith('app-1', 'listDeals', { status: null, stageId: null, owner: null });
  });

  it('asks before redeeming an invitation, then opens that workspace', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    localStorage.setItem(`${APP}:pending-invite`, 'tok-xyz');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-xyz'), SLOW);
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
  });

  it('labels the landing page action "Sign in" and offers no desktop app on a web-only app', async () => {
    render(<App deps={deps(fakeClient())} />);
    expect((await screen.findAllByRole('button', { name: 'Sign in' }, SLOW)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /connect to node/i })).toBeNull();
    expect(screen.queryByText(/get the desktop app/i)).toBeNull();
    expect(document.querySelector('a[href="https://calimero.network/download"]')).toBeNull();
  });

  it('shows an invitation page, not the landing page, to a signed-out visitor with an invite', async () => {
    localStorage.setItem(`${APP}:pending-invite`, 'tok-xyz');
    render(<App deps={deps(fakeClient())} />);

    expect(await screen.findByTestId('invitation-page', {}, SLOW)).toBeTruthy();
    expect(screen.getByText(/You've been invited to join a workspace in Mero CRM/)).toBeTruthy();
    expect(screen.getByTestId('signin-passkey')).toBeTruthy();
    // A page, not a popup over the landing hero.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.cal-lp-root')).toBeNull();
  });

  it('"Not now" shows the landing page and keeps the invitation', async () => {
    localStorage.setItem(`${APP}:pending-invite`, 'tok-xyz');
    render(<App deps={deps(fakeClient())} />);

    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(document.querySelector('.cal-lp-root')).not.toBeNull(), SLOW);
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBe('tok-xyz');
  });

  it('asks to join right after signing in from the invitation page, then opens the linked route', async () => {
    const client = fakeClient();
    localStorage.setItem(`${APP}:pending-invite`, 'tok-xyz');
    localStorage.setItem(`${APP}:pending-invite-route`, '/crm/members');
    window.history.replaceState(null, '', '/crm/members');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
    // No second click to reach the prompt.
    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-xyz'), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it('tells a member of the invited workspace they are already in it, without spending the invite', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    localStorage.setItem(`${APP}:pending-invite`, 'tok-xyz');
    localStorage.setItem(`${APP}:pending-invite-org`, 'org-1');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    expect(await screen.findByText("You're already in this workspace", {}, SLOW)).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
    fireEvent.click(screen.getByTestId('invitation-continue'));
    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
  });

  it('says plainly when the invite was already used or has expired', async () => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, 'NOT_FOUND', 'unknown invite'));
    storeSession();
    localStorage.setItem(`${APP}:pending-invite`, 'tok-used');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    expect(
      await screen.findByText(
        'This invite was already used or has expired. Ask the person who invited you for a new link.',
        {},
        SLOW,
      ),
    ).toBeTruthy();
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
  });
});
