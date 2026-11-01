import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CalimeroClient, CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import type { SessionDeps } from './session';
import { APP } from './session';
import { writeActiveNs } from './hooks/workspacePersistence';

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
    expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' });
    expect(screen.queryByText('elsewhere')).toBeNull();
    expect(client.view).toHaveBeenCalledWith('app-1', 'listIssues', { status: null, assignee: null, label: null });
  });

  it('asks before redeeming an invitation, then opens that workspace', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    localStorage.setItem(`${APP}:pending-invite`, 'tok-xyz');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-xyz'), SLOW);
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
  });
});
