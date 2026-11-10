import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalimeroError, type CalimeroClient, type CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import type { SessionDeps } from './session';
import { APP } from './session';
import { readActiveNs, writeActiveNs } from './hooks/workspacePersistence';
import { invites } from './workspaces';

/** Hold `token` as the pending invite, as a captured link would. */
function holdInvite(token: string, target: { org?: string; route?: string } = {}) {
  invites.put({ token, org: target.org ?? null, team: null, doc: null, route: target.route ?? null, extra: {} });
}

const SESSION: CalimeroSession = { accountId: 'acct-alice', sessionToken: 's', refreshToken: 'r', expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };

const ISSUE = {
  id: 'issue-1700000000000-aabbccdd',
  title: 'Login broken',
  summary: 'Clicking login does nothing',
  impact: 'Nobody can sign in',
  repro: 'Click login',
  resolutionCriteria: 'Login works',
  status: 'Open',
  priority: 'high',
  assignee: null,
  labels: ['bug'],
  createdBy: 'acct-alice',
  createdAt: '1700000000000',
};

function fakeClient(opts: { signedIn?: boolean } = {}) {
  let session: CalimeroSession | undefined = opts.signedIn ? SESSION : undefined;
  const views: Record<string, unknown> = {
    listIssues: [ISSUE],
    getStatusCounts: [
      { status: 'Open', count: '1' },
      { status: 'In progress', count: '0' },
      { status: 'Blocked', count: '0' },
      { status: 'Done', count: '0' },
    ],
    getRepoInfo: { repoUrl: 'https://github.com/acme/app' },
    getIssue: { issue: ISSUE, comments: [] },
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
      { appId: 'app-1', name: 'web', owner: 'acct-alice', org: 'org-1', bundle: 'bundle-hash', package: null, version: null },
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
  // The account of the bug: in `overworld`, which holds only a Mero Blocks world.
  it('does not list or enter an org made for another app; connects it on request', async () => {
    const client = fakeClient({ signedIn: true });
    const blocks = { appId: 'w1', name: 'overworld', owner: 'acct-alice', org: 'ow', bundle: 'blocks', package: 'com.calimero.mero-blocks', version: null };
    client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'ow', name: 'overworld', role: 'owner' }] }));
    client.listApps.mockImplementation((async (f?: { bundle?: string }) => (f?.bundle ? [] : [blocks])) as never);
    storeSession();
    writeActiveNs('ow');
    window.history.replaceState(null, '', '/tracker');
    render(<App deps={deps(client)} />);
    expect(await screen.findByTestId('ns-empty-state', {}, SLOW)).toBeTruthy();
    expect(screen.queryByTestId('connect-org-ow')).toBeNull();
    fireEvent.click(screen.getByTestId('connect-existing-org'));
    const choice = await screen.findByTestId('connect-org-ow', {}, SLOW);
    expect(choice.textContent).toContain('Mero Blocks: overworld');
    fireEvent.click(choice);
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith('Issues', 'bundle-hash', { org: 'ow' }), SLOW);
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it('signs in with a passkey from the landing page', async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    const connect = await screen.findAllByRole('button', { name: /sign in|connect|get started|open/i }, SLOW);
    fireEvent.click(connect[0]);
    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
  });

  it('opens the remembered workspace on its first repo and shows its issues', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    // Only this workspace's repos, and the board read from the open one.
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' }));
    expect(screen.queryByText('elsewhere')).toBeNull();
    expect(client.view).toHaveBeenCalledWith('app-1', 'listIssues', { status: null, assignee: null, label: null });
  });

  it('asks before redeeming an invitation, then opens that workspace', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-xyz'), SLOW);
    expect(invites.token()).toBeNull();
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
  });

  it('labels the landing page action "Sign in" and offers no desktop app on a web-only app', async () => {
    render(<App deps={deps(fakeClient())} />);
    expect((await screen.findAllByRole('button', { name: 'Sign in' }, SLOW)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /connect to node/i })).toBeNull();
    expect(screen.queryByText(/get the desktop app/i)).toBeNull();
    expect(document.querySelector('a[href="https://calimero.network/download"]')).toBeNull();
  });

  it('shows an invitation page, not the landing page, to a signed-out visitor with an invite', async () => {
    holdInvite('tok-xyz');
    render(<App deps={deps(fakeClient())} />);

    expect(await screen.findByTestId('invitation-page', {}, SLOW)).toBeTruthy();
    expect(screen.getByText(/You've been invited to join the workspace in Mero Issue Tracker/)).toBeTruthy();
    expect(screen.getByTestId('signin-passkey')).toBeTruthy();
    // A page, not a popup over the landing hero.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.cal-lp-root')).toBeNull();
  });

  it('"Not now" shows the landing page and keeps the invitation', async () => {
    holdInvite('tok-xyz');
    render(<App deps={deps(fakeClient())} />);

    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(document.querySelector('.cal-lp-root')).not.toBeNull(), SLOW);
    expect(invites.token()).toBe('tok-xyz');
  });

  it('asks to join right after signing in from the invitation page, then opens the linked route', async () => {
    const client = fakeClient();
    holdInvite('tok-xyz', { route: '/issue-tracker/board' });
    window.history.replaceState(null, '', '/issue-tracker/board');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
    // No second click to reach the prompt.
    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-xyz'), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe('/issue-tracker/board'), SLOW);
    expect(invites.token()).toBeNull();
  });

  it('tells a member of the invited workspace they are already in it, without spending the invite', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz', { org: 'org-1' });
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    expect(await screen.findByText("You're already in this workspace", {}, SLOW)).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    fireEvent.click(screen.getByTestId('invitation-continue'));
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
  });

  it('says plainly when the invite was already used or has expired', async () => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, 'NOT_FOUND', 'unknown invite'));
    storeSession();
    holdInvite('tok-used');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    expect(
      await screen.findByText(
        'This invite was already used or has expired. Ask the person who invited you for a new link.',
        {},
        SLOW,
      ),
    ).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it('an invited newcomer who signs up from the landing page lands on the page the link named (B10)', async () => {
    const client = fakeClient();
    window.history.replaceState(null, '', '/issue-tracker/board?invite=tok-xyz&org=org-1');
    invites.capture(window.location);
    render(<App deps={deps(client)} />);

    // "Not now", then create the account from the landing page: the sign-up joins.
    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/'), SLOW);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Sign in' }, SLOW))[0]);
    fireEvent.click(await screen.findByTestId('signup-passkey', {}, SLOW));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-xyz' }), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe('/issue-tracker/board'), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe('/issue-tracker/board');
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    expect(readActiveNs()).toBe('org-1');
  });

  it.each([
    [429, 'RATE_LIMITED', /Too many tries/],
    [401, 'UNAUTHENTICATED', /sign in again/],
  ])('keeps the invite when redeeming answers %i, and says to try again (B6)', async (status, code, says) => {
    const client = fakeClient({ signedIn: true });
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, 'not now'));
    storeSession();
    holdInvite('tok-xyz');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    expect(await screen.findByText(says, {}, SLOW)).toBeTruthy();
    expect(invites.token()).toBe('tok-xyz');
    expect(screen.getByTestId('invitation-join').textContent).toBe('Try again');
  });
});
