import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CalimeroError, type CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import App from './App';
import type { SessionDeps } from './session';
import { APP } from './session';
import { readActiveNs, writeActiveNs } from './hooks/workspacePersistence';
import { invites } from './workspaces';
import { withRoutes } from '@calimero-apps/connect/testing';

// `useInstanceRelease` as on a page a node serves from `release.href` (a
// release's `/{version}/`), going nowhere but `release.navigate`. With no
// `href` it reads this test's own location: development, where it never moves.
const release = vi.hoisted(() => ({ href: null as string | null, navigate: vi.fn() }));
const shieldApp = vi.hoisted(() => vi.fn());
vi.mock('@calimero-apps/passkey', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@calimero-apps/passkey')>();
  return {
    ...actual,
    useNodeShieldApp: (...args: Parameters<typeof actual.useNodeShieldApp>) => {
      shieldApp(...args);
      return actual.useNodeShieldApp(...args);
    },
    useInstanceRelease: (...[client, app]: Parameters<typeof actual.useInstanceRelease>) =>
      actual.useInstanceRelease(client, app, release.href ? { href: release.href, navigate: release.navigate } : {}),
  };
});
// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock('@calimero-network/mero-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@calimero-network/mero-react')>();
  return {
    ...actual,
    CreateWorkspaceDialog: (p: Parameters<typeof actual.CreateWorkspaceDialog>[0]) =>
      p.open
        ? createElement(
            'div',
            { 'data-testid': 'create-dialog' },
            p.release === null
              ? createElement('p', { 'data-testid': 'create-pending' }, 'pending')
              : [
                  createElement('h2', { key: 't', 'data-testid': 'create-title' }, p.labels?.title),
                  createElement('pre', { key: 's', 'data-testid': 'create-source' }, JSON.stringify(p.release)),
                  createElement('button', { key: 'b', 'data-testid': 'create-done', onClick: () => p.onCreated({ orgId: 'org-new', name: 'Platform', selfName: 'Alice' }) }, 'done'),
                ],
          )
        : null,
    InviteDialog: (p: Parameters<typeof actual.InviteDialog>[0]) =>
      p.open
        ? createElement('div', { 'data-testid': 'invite-dialog' }, [
            createElement('h2', { key: 't', 'data-testid': 'invite-title' }, p.labels?.title),
            createElement('p', { key: 's', 'data-testid': 'invite-note' }, p.labels?.note),
            createElement('p', { key: 'n', 'data-testid': 'invite-inviter' }, p.inviterName),
            createElement('pre', { key: 'p', 'data-testid': 'invite-props' }, JSON.stringify({ org: p.org, teams: p.teams, appName: p.appName, linkBase: p.linkBase })),
          ])
        : null,
    AcceptInviteDialog: (p: Parameters<typeof actual.AcceptInviteDialog>[0]) =>
      p.open
        ? createElement('div', { 'data-testid': 'accept-dialog', 'data-token': p.token, 'data-app': p.appName, 'data-org': p.org }, [
            createElement('button', { key: 'j', 'data-testid': 'invitation-join', onClick: () => p.onJoined({ org: 'org-1', alreadyMember: false }) }, 'join'),
            createElement('button', { key: 'c', 'data-testid': 'invitation-close', onClick: p.onClose }, 'close'),
            createElement('button', { key: 'u', 'data-testid': 'invitation-spent', onClick: () => p.onError?.(new CalimeroError(400, 'REJECTED', 'this invite has expired')) }, 'spent'),
            createElement('button', { key: 'l', 'data-testid': 'invitation-lapsed', onClick: () => p.onError?.(new CalimeroError(401, 'UNAUTHORIZED', 'session expired')) }, 'lapsed'),
          ])
        : null,
  };
});
const HOST = `https://${'a'.repeat(52)}.apps.calimero.network`;

/** Hold `token` as the pending invite, as a captured link would. */
function holdInvite(token: string, target: { org?: string; route?: string } = {}) {
  invites.put({ token, org: target.org ?? null, team: null, doc: null, route: target.route ?? null, extra: {} });
}

const SESSION: CalimeroSession = { accountId: 'acct-alice', sessionToken: 's', refreshToken: 'r', expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };
const UNVERSIONED_ENV = { DEV: true, VITE_CALIMERO_PACKAGE: 'com.calimero.mero-crm' };
const PACKAGE_ENV = { DEV: true, VITE_CALIMERO_PACKAGE: 'com.calimero.mero-crm', VITE_CALIMERO_VERSION: '1.4.0' };

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
  const client = withRoutes({
    nodes: [],
    package: vi.fn(async () => ({ latest: '2.0.0' })),
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
    setOrgMetadata: vi.fn(async () => {}),
    setCapabilities: vi.fn(async () => {}),
    createApp: vi.fn(async () => 'app-new'),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: views[method] ?? null })),
    events: vi.fn(async function* () {}),
    invite: vi.fn(async () => 'tok-123'),
    redeemInvite: vi.fn(async () => ({ org: 'org-1' })),
    setMemberMetadata: vi.fn(async () => {}),
  });
  return client;
}

function deps(client: ReturnType<typeof fakeClient>, env: SessionDeps['env'] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: async () => withRoutes(client),
    passkey: () => ({}) as never,
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  release.href = null;
  release.navigate.mockClear();
  shieldApp.mockClear();
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

/** Clicks the landing's current sign-in CTA until the passkey popup is open: a CTA found before the session settles is detached. */
async function openSignIn() {
  await waitFor(() => {
    if (!screen.queryByTestId('signin-passkey')) {
      fireEvent.click(screen.getAllByRole('button', { name: /sign in|connect|get started|open/i })[0]!);
    }
    expect(screen.getByTestId('signin-passkey')).toBeTruthy();
  }, SLOW);
}

function storeSession() {
  new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
}

describe('App', () => {
  // The account of the bug: in `overworld`, which holds only a Hyperfeed Blocks world.
  it('does not list or enter an org made for another app; connects it on request', async () => {
    const client = fakeClient({ signedIn: true });
    const blocks = { appId: 'w1', name: 'overworld', owner: 'acct-alice', org: 'ow', bundle: 'blocks', package: 'com.calimero.mero-blocks', version: null };
    client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'ow', name: 'overworld', role: 'owner' }] }));
    client.listApps.mockImplementation((async (f?: { bundle?: string }) => (f?.bundle ? [] : [blocks])) as never);
    storeSession();
    writeActiveNs('ow');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);
    expect(await screen.findByTestId('ns-empty-state', {}, SLOW)).toBeTruthy();
    expect(screen.queryByTestId('connect-org-ow')).toBeNull();
    fireEvent.click(screen.getByTestId('connect-existing-org'));
    const choice = await screen.findByTestId('connect-org-ow', {}, SLOW);
    expect(choice.textContent).toContain('Hyperfeed Blocks: overworld');
    fireEvent.click(choice);
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith('Pipeline', 'bundle-hash', { org: 'ow' }), SLOW);
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it('tells the node shield which instance is open and where its code comes from', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
    expect(shieldApp).toHaveBeenCalledWith('app-1', 'bundle-hash');
  });

  it('shows the open pipeline\'s trust view and its updates in settings', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/crm/settings');
    render(<App deps={deps(client)} />);

    expect(await screen.findByTestId('trust-settings', {}, SLOW)).toBeTruthy();
    expect(screen.getByTestId('updates-settings')).toBeTruthy();
  });

  it('signs in with a passkey from the landing page', async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await openSignIn();
    fireEvent.click(screen.getByTestId('signin-passkey'));
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

  it('hands the pending invite to the shared join dialog, then opens that workspace', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    const dialog = await screen.findByTestId('accept-dialog', {}, SLOW);
    expect(dialog.dataset.token).toBe('tok-xyz');
    expect(dialog.dataset.app).toBe('Hyperfeed CRM');
    fireEvent.click(screen.getByTestId('invitation-join'));
    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
    expect(invites.token()).toBeNull();
    expect(readActiveNs()).toBe('org-1');
    expect(client.redeemInvite).not.toHaveBeenCalled();
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
    expect(screen.getByText(/You've been invited to join the workspace in Hyperfeed CRM/)).toBeTruthy();
    expect(screen.getByTestId('signin-passkey')).toBeTruthy();
    // A page, not a popup over the landing hero.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.cal-lp-root')).toBeNull();
  });

  it('an invited newcomer creates the account and joins in one click, and lands in the workspace', async () => {
    const client = fakeClient();
    holdInvite('tok-xyz');
    render(<App deps={deps(client)} />);

    const create = await screen.findByTestId('signup-passkey', {}, SLOW);
    expect(create.textContent).toBe('Create your account and join the workspace');
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-xyz' }), SLOW);
    await waitFor(() => expect(screen.queryByTestId('invitation-page')).toBeNull(), SLOW);
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invitation-dialog')).toBeNull();
    expect(invites.token()).toBeNull();
    expect(readActiveNs()).toBe('org-1');
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
    holdInvite('tok-xyz', { route: '/crm/members' });
    window.history.replaceState(null, '', '/crm/members');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    await waitFor(() => expect(client.signIn).toHaveBeenCalledTimes(1), SLOW);
    // No second click to reach the prompt.
    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    expect(invites.token()).toBeNull();
  });

  it('passes the invite org to the dialog, which tells a member so; continuing opens the workspace', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz', { org: 'org-1' });
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    expect((await screen.findByTestId('accept-dialog', {}, SLOW)).getAttribute('data-org')).toBe('org-1');
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('invitation-join'));
    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it('drops the stored invite when the node says it is spent, and keeps the message up until closed', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-used');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-spent', {}, SLOW));
    await waitFor(() => expect(invites.token()).toBeNull(), SLOW);
    expect(screen.getByTestId('accept-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('invitation-close'));
    await waitFor(() => expect(screen.queryByTestId('accept-dialog')).toBeNull(), SLOW);
  });

  it('keeps the stored invite when the join failed for a lapsed session', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-lapsed', {}, SLOW));
    expect(invites.token()).toBe('tok-xyz');
    expect(screen.getByTestId('accept-dialog')).toBeTruthy();
  });

  it('closing the join dialog drops the invitation and shows the app', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-used');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-close', {}, SLOW));
    await waitFor(() => expect(invites.token()).toBeNull(), SLOW);
    await waitFor(() => expect(screen.queryByTestId('accept-dialog')).toBeNull(), SLOW);
  });

  it('lands on the deep-linked route after joining, even from the landing page the sign-in redirect left', async () => {
    // The front door's own redirect (signed in at `/` -> /crm) must not win
    // against the move to the invite's route.
    const client = fakeClient();
    window.history.replaceState(null, '', '/crm/members?invite=tok-xyz&org=org-2');
    invites.capture(window.location);
    render(<App deps={deps(client)} />);

    // "Not now": the guard on /crm/members sends a signed-out visitor to `/`.
    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/'), SLOW);
    // Sign in from the landing page: the join prompt follows with no extra click.
    await openSignIn();
    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    // And it stays there: no late redirect to the CRM's start.
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe('/crm/members');
  });

  it('lands on the deep-linked route after signing in on the invitation page and joining', async () => {
    const client = fakeClient();
    window.history.replaceState(null, '', '/crm/members?invite=tok-xyz&org=org-2');
    invites.capture(window.location);
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe('/crm/members');
    expect(window.location.search).toBe('');
  });

  it('an invited newcomer who signs up from the landing page lands on the page the link named (B10)', async () => {
    const client = fakeClient();
    window.history.replaceState(null, '', '/crm/members?invite=tok-xyz&org=org-1');
    invites.capture(window.location);
    render(<App deps={deps(client)} />);

    // "Not now", then create the account from the landing page: the sign-up joins.
    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/'), SLOW);
    await openSignIn();
    fireEvent.click(await screen.findByTestId('signup-passkey', {}, SLOW));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-xyz' }), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe('/crm/members'), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe('/crm/members');
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    expect(readActiveNs()).toBe('org-1');
  });

  describe('inviting people', () => {
    /** The open workspace, with this app's team in it when `teamed`. */
    async function openMembers(teamed: boolean, mode = 'standalone') {
      const client = fakeClient({ signedIn: true });
      client.getOrg.mockImplementation(async () => ({
        members: { 'acct-alice': 'owner', 'acct-bob': 'member' },
        memberMetadata: { 'acct-alice': { name: 'Alice' }, 'acct-bob': { name: 'Bob' } },
        capabilities: {},
        defaultCapabilities: 3,
        mode,
        teams: teamed ? { 'team-crm': { metadata: { app: { package: 'com.calimero.mero-crm' } }, members: {} } } : {},
      }));
      new SessionStore(APP, resolveTarget(PACKAGE_ENV), localStorage).save(SESSION);
      writeActiveNs('org-1');
      window.history.replaceState(null, '', '/crm/members');
      render(<App deps={deps(client, PACKAGE_ENV)} />);
      fireEvent.click(await screen.findByTestId('open-invite-btn', {}, SLOW));
      return JSON.parse((await screen.findByTestId('invite-props', {}, SLOW)).textContent ?? 'null');
    }

    it('opens the shared dialog on this app\'s team, and a link that opens the app', async () => {
      const props = await openMembers(true);
      expect(props).toMatchObject({ org: 'org-1', teams: ['team-crm'], appName: 'Hyperfeed CRM' });
      const base = new URL(props.linkBase);
      expect(base.searchParams.get('org')).toBe('org-1');
      expect(base.searchParams.get('to')).toBe('/crm/members');
      expect(base.searchParams.has('invite')).toBe(false);
      expect(screen.getByTestId('invite-title').textContent).toBe('Invite to workspace');
    });

    it('names no team in an org that has none for this app', async () => {
      expect((await openMembers(false)).teams).toEqual([]);
    });

    it('says an invite gives this app only where the org keeps its apps apart', async () => {
      await openMembers(true, 'shared');
      expect(screen.getByTestId('invite-note').textContent).toMatch(/Invites to Hyperfeed CRM only/);
    });
  });

  describe('your name, asked once per workspace', () => {
    /** An org that has no name for Alice yet, until `setMemberMetadata` writes one. */
    function unnamed(client: ReturnType<typeof fakeClient>) {
      let alice: Record<string, unknown> | undefined;
      const mocks = client as unknown as { getOrg: Mock; setMemberMetadata: Mock };
      mocks.getOrg.mockImplementation(async () => ({
        members: { 'acct-alice': 'owner', 'acct-bob': 'member' },
        memberMetadata: { ...(alice ? { 'acct-alice': alice } : {}), 'acct-bob': { name: 'Bob' } },
        capabilities: {},
        defaultCapabilities: 3,
      }));
      mocks.setMemberMetadata.mockImplementation(async (_org: string, _account: string, meta: Record<string, unknown>) => {
        alice = meta;
      });
    }

    it('never asks on opening a workspace that already has your name', async () => {
      const client = fakeClient({ signedIn: true });
      storeSession();
      writeActiveNs('org-1');
      window.history.replaceState(null, '', '/crm');
      render(<App deps={deps(client)} />);

      expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(client.setMemberMetadata).not.toHaveBeenCalled();
    });

    /** Signed in with no workspace, to the open create dialog (the shared one, stubbed). */
    async function startCreating(client: ReturnType<typeof fakeClient>, env: SessionDeps['env']) {
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [] }));
      new SessionStore(APP, resolveTarget(env), localStorage).save(SESSION);
      window.history.replaceState(null, '', '/crm');
      render(<App deps={deps(client, env)} />);
      fireEvent.click(await screen.findByTestId('ns-create-btn', {}, SLOW));
    }

    /** The release the stubbed dialog was handed. */
    const dialogSource = async () => JSON.parse((await screen.findByTestId('create-source', {}, SLOW)).textContent ?? 'null');

    it('opens the shared dialog with the app wording and the release a package app creates from', async () => {
      const client = fakeClient({ signedIn: true });
      await startCreating(client, PACKAGE_ENV);
      expect(await dialogSource()).toEqual({ package: 'com.calimero.mero-crm', version: '1.4.0' });
      expect(screen.getByTestId('create-title').textContent).toBe('New workspace');
      expect(client.createOrg).not.toHaveBeenCalled();
    });

    it('reviews the newest release, and opens the dialog only once it is read', async () => {
      const client = fakeClient({ signedIn: true });
      const answer = slowRelease(client);
      await startCreating(client, UNVERSIONED_ENV);
      expect((await screen.findByTestId('create-pending', {}, SLOW)).textContent).toBe('pending');
      answer('2.0.0');
      expect(await dialogSource()).toEqual({ package: 'com.calimero.mero-crm', version: '2.0.0' });
    });

    it('names you in the workspace the dialog made, and opens it', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      localStorage.setItem('calimero-names:last', 'Alice L');
      await startCreating(client, PACKAGE_ENV);
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'org-new', name: 'Platform', role: 'owner' }] }));
      fireEvent.click(await screen.findByTestId('create-done', {}, SLOW));

      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-new', 'acct-alice', { name: 'Alice' }), SLOW);
      await waitFor(() => expect(readActiveNs()).toBe('org-new'), SLOW);
      await new Promise((r) => setTimeout(r, 200));
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(screen.queryByTestId('create-dialog')).toBeNull();
      expect(client.createOrg).not.toHaveBeenCalled();
    });

    it('sets the member defaults for an unbound session, and says so when they are refused', async () => {
      const client = fakeClient({ signedIn: true });
      client.setCapabilities.mockRejectedValue(new Error('declined'));
      await startCreating(client, PACKAGE_ENV);
      fireEvent.click(await screen.findByTestId('create-done', {}, SLOW));
      await waitFor(() => expect(client.setCapabilities).toHaveBeenCalledTimes(1), SLOW);
      expect(await screen.findByText(/people you invite will not be able to add pipelines/, {}, SLOW)).toBeTruthy();
    });

    it('skips the member defaults silently on a session bound to the app', async () => {
      const client = fakeClient({ signedIn: true });
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [], app: 'com.calimero.mero-crm' }));
      await startCreating(client, PACKAGE_ENV);
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'org-new', name: 'Platform', role: 'owner' }], app: 'com.calimero.mero-crm' }));
      fireEvent.click(await screen.findByTestId('create-done', {}, SLOW));
      await waitFor(() => expect(readActiveNs()).toBe('org-new'), SLOW);
      expect(client.setCapabilities).not.toHaveBeenCalled();
      expect(screen.queryByText(/people you invite will not be able/)).toBeNull();
    });

    function slowRelease(client: ReturnType<typeof fakeClient>) {
      let answer: (v: { latest: string }) => void = () => {};
      client.package.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      return (latest: string) => answer({ latest });
    }

    it('holds adding a pipeline back until the newest release is read', async () => {
      const client = fakeClient({ signedIn: true });
      const answer = slowRelease(client);
      new SessionStore(APP, resolveTarget(UNVERSIONED_ENV), localStorage).save(SESSION);
      writeActiveNs('org-1');
      window.history.replaceState(null, '', '/crm');
      render(<App deps={deps(client, UNVERSIONED_ENV)} />);

      expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
      fireEvent.click(screen.getByTestId('pipeline-add-btn'));
      fireEvent.change(await screen.findByTestId('pipeline-add-name', {}, SLOW), { target: { value: 'Renewals' } });
      const submit = screen.getByTestId('pipeline-add-submit') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      expect(screen.getByTestId('release-checking')).toBeTruthy();
      answer('2.0.0');
      await waitFor(() => expect(submit.disabled).toBe(false), SLOW);
      expect(screen.queryByTestId('release-checking')).toBeNull();
    });

    it('holds connecting an existing organization back until the newest release is read', async () => {
      const client = fakeClient({ signedIn: true });
      const answer = slowRelease(client);
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [] }));
      new SessionStore(APP, resolveTarget(UNVERSIONED_ENV), localStorage).save(SESSION);
      window.history.replaceState(null, '', '/crm');
      render(<App deps={deps(client, UNVERSIONED_ENV)} />);

      expect(await screen.findByTestId('ns-create-btn', {}, SLOW)).toBeTruthy();
      expect(screen.queryByTestId('connect-existing-org')).toBeNull();
      expect(screen.getByTestId('release-checking')).toBeTruthy();
      answer('2.0.0');
      expect(await screen.findByTestId('connect-existing-org', {}, SLOW)).toBeTruthy();
      expect(screen.queryByTestId('release-checking')).toBeNull();
    });


    it('asks once right after joining a workspace that has no name for you', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      localStorage.setItem('calimero-names:last', 'Alice');
      storeSession();
      holdInvite('tok-xyz');
      window.history.replaceState(null, '', '/crm');
      render(<App deps={deps(client)} />);

      fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
      const input = (await screen.findByTestId('alias-gate-name', {}, SLOW)) as HTMLInputElement;
      expect(input.value).toBe('Alice');
      fireEvent.click(screen.getByTestId('alias-gate-save'));

      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-1', 'acct-alice', { name: 'Alice' }), SLOW);
      expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
      // Not asked again on opening the workspace.
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(client.setMemberMetadata).toHaveBeenCalledTimes(1);
    });

    it('asks once on entering a workspace made before names were asked, then never again', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      storeSession();
      writeActiveNs('org-1');
      window.history.replaceState(null, '', '/crm');
      const { unmount } = render(<App deps={deps(client)} />);

      fireEvent.change(await screen.findByTestId('alias-gate-name', {}, SLOW), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByTestId('alias-gate-save'));
      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-1', 'acct-alice', { name: 'Alice' }), SLOW);
      await waitFor(() => expect(screen.queryByTestId('alias-gate')).toBeNull(), SLOW);
      unmount();

      render(<App deps={deps(client)} />);
      expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
      expect(screen.queryByTestId('alias-gate')).toBeNull();
    });
  });
});

describe('the release the open pipeline runs (useInstanceRelease)', () => {
  /** Signed in, in the remembered workspace, whose first pipeline runs `version`. */
  function openPipeline(version: string) {
    const client = Object.assign(fakeClient({ signedIn: true }), withRoutes({
      getApp: vi.fn(async () => ({ appId: 'app-1', org: 'org-1' })),
      appsReportAll: vi.fn(async () => ({ apps: [{ app: 'app-1', package: { package: 'com.calimero.crm', version } }] })),
    }));
    storeSession();
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/crm');
    render(<App deps={deps(client)} />);
    return client;
  }

  it('moves a served page to the frontend of the release the pipeline runs, and shows nothing of it meanwhile', async () => {
    release.href = `${HOST}/1.2.0/crm?deal=7`;
    openPipeline('1.0.0');
    await waitFor(() => expect(release.navigate).toHaveBeenCalledWith(`${HOST}/app/app-1/crm?deal=7`), SLOW);
    expect(release.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Acme 50 seats')).toBeNull(), SLOW);
  });

  it('stays on a served page of the release the pipeline runs', async () => {
    release.href = `${HOST}/1.2.0/crm`;
    const client = openPipeline('1.2.0');
    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(client.appsReportAll).toHaveBeenCalledWith('org-1'), SLOW);
    await new Promise((r) => setTimeout(r, 0));
    expect(release.navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Acme 50 seats')).toBeTruthy();
  });

  it('does nothing in development', async () => {
    const client = openPipeline('1.0.0');
    expect(await screen.findByText('Acme 50 seats', {}, SLOW)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getApp).not.toHaveBeenCalled();
    expect(release.navigate).not.toHaveBeenCalled();
  });
});
