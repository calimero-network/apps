import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('@calimero-apps/passkey', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@calimero-apps/passkey')>();
  return {
    ...actual,
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
const UNVERSIONED_ENV = { DEV: true, VITE_CALIMERO_PACKAGE: 'com.calimero.mero-issue-tracker' };

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
  const client = withRoutes({
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
    setOrgMetadata: vi.fn(async () => {}),
    setCapabilities: vi.fn(async () => {}),
    createApp: vi.fn(async () => 'app-new'),
    package: vi.fn(async () => ({ latest: '2.0.0' })),
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

function storeSession(env: SessionDeps['env'] = DEV_ENV) {
  new SessionStore(APP, resolveTarget(env), localStorage).save(SESSION);
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
    expect(choice.textContent).toContain('Hyperfeed Blocks: overworld');
    fireEvent.click(choice);
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith('Issues', 'bundle-hash', { org: 'ow' }), SLOW);
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it('signs in with a passkey from the landing page', async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await openSignIn();
    fireEvent.click(screen.getByTestId('signin-passkey'));
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

  it('hands the pending invite to the shared join dialog, then opens that workspace', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    const dialog = await screen.findByTestId('accept-dialog', {}, SLOW);
    expect(dialog.dataset.token).toBe('tok-xyz');
    expect(dialog.dataset.app).toBe('Mero Issue Tracker');
    fireEvent.click(screen.getByTestId('invitation-join'));
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
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
    await waitFor(() => expect(window.location.pathname).toBe('/issue-tracker/board'), SLOW);
    expect(invites.token()).toBeNull();
  });

  it('passes the invite org to the dialog, which tells a member so; continuing opens the workspace', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-xyz', { org: 'org-1' });
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    expect((await screen.findByTestId('accept-dialog', {}, SLOW)).getAttribute('data-org')).toBe('org-1');
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('invitation-join'));
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it('drops the stored invite when the node says it is spent, and keeps the message up until closed', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-used');
    window.history.replaceState(null, '', '/issue-tracker');
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
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-lapsed', {}, SLOW));
    expect(invites.token()).toBe('tok-xyz');
    expect(screen.getByTestId('accept-dialog')).toBeTruthy();
  });

  it('closing the join dialog drops the invitation and shows the app', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession();
    holdInvite('tok-used');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);

    fireEvent.click(await screen.findByTestId('invitation-close', {}, SLOW));
    await waitFor(() => expect(invites.token()).toBeNull(), SLOW);
    await waitFor(() => expect(screen.queryByTestId('accept-dialog')).toBeNull(), SLOW);
  });

  it('an invited newcomer who signs up from the landing page lands on the page the link named (B10)', async () => {
    const client = fakeClient();
    window.history.replaceState(null, '', '/issue-tracker/board?invite=tok-xyz&org=org-1');
    invites.capture(window.location);
    render(<App deps={deps(client)} />);

    // "Not now", then create the account from the landing page: the sign-up joins.
    fireEvent.click(await screen.findByTestId('invitation-later', {}, SLOW));
    await waitFor(() => expect(window.location.pathname).toBe('/'), SLOW);
    await openSignIn();
    fireEvent.click(await screen.findByTestId('signup-passkey', {}, SLOW));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-xyz' }), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe('/issue-tracker/board'), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(window.location.pathname).toBe('/issue-tracker/board');
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
        teams: teamed ? { 'team-tracker': { metadata: { app: { package: 'com.calimero.mero-issue-tracker' } }, members: {} } } : {},
      }));
      new SessionStore(APP, resolveTarget(UNVERSIONED_ENV), localStorage).save(SESSION);
      writeActiveNs('org-1');
      window.history.replaceState(null, '', '/issue-tracker/members');
      render(<App deps={deps(client, UNVERSIONED_ENV)} />);
      fireEvent.click(await screen.findByTestId('open-invite-btn', {}, SLOW));
      return JSON.parse((await screen.findByTestId('invite-props', {}, SLOW)).textContent ?? 'null');
    }

    it('opens the shared dialog on this app\'s team, and a link that opens the app', async () => {
      const props = await openMembers(true);
      expect(props).toMatchObject({ org: 'org-1', teams: ['team-tracker'], appName: 'Mero Issue Tracker' });
      const base = new URL(props.linkBase);
      expect(base.searchParams.get('org')).toBe('org-1');
      expect(base.searchParams.get('to')).toBe('/issue-tracker/members');
      expect(base.searchParams.has('invite')).toBe(false);
      expect(screen.getByTestId('invite-title').textContent).toBe('Invite to workspace');
    });

    it('names no team in an org that has none for this app', async () => {
      expect((await openMembers(false)).teams).toEqual([]);
    });

    it('says an invite gives this app only where the org keeps its apps apart', async () => {
      await openMembers(true, 'shared');
      expect(screen.getByTestId('invite-note').textContent).toMatch(/Invites to Mero Issue Tracker only/);
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
      window.history.replaceState(null, '', '/issue-tracker');
      render(<App deps={deps(client)} />);

      expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(client.setMemberMetadata).not.toHaveBeenCalled();
    });

    it('names you in the workspace the dialog made, and opens it', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [] }));
      storeSession();
      window.history.replaceState(null, '', '/issue-tracker');
      render(<App deps={deps(client)} />);

      fireEvent.click(await screen.findByTestId('ns-create-btn', {}, SLOW));
      client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'org-new', name: 'Platform', role: 'owner' }] }));
      fireEvent.click(await screen.findByTestId('create-done', {}, SLOW));

      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-new', 'acct-alice', { name: 'Alice' }), SLOW);
      await waitFor(() => expect(readActiveNs()).toBe('org-new'), SLOW);
      await new Promise((r) => setTimeout(r, 200));
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(screen.queryByTestId('create-dialog')).toBeNull();
      expect(client.createOrg).not.toHaveBeenCalled();
    });

    it('asks once right after joining a workspace that has no name for you', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      localStorage.setItem('calimero-names:last', 'Alice');
      storeSession();
      holdInvite('tok-xyz');
      window.history.replaceState(null, '', '/issue-tracker');
      render(<App deps={deps(client)} />);

      fireEvent.click(await screen.findByTestId('invitation-join', {}, SLOW));
      const input = (await screen.findByTestId('alias-gate-name', {}, SLOW)) as HTMLInputElement;
      expect(input.value).toBe('Alice');
      fireEvent.click(screen.getByTestId('alias-gate-save'));

      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-1', 'acct-alice', { name: 'Alice' }), SLOW);
      expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
      // Not asked again on opening the workspace.
      expect(screen.queryByTestId('alias-gate')).toBeNull();
      expect(client.setMemberMetadata).toHaveBeenCalledTimes(1);
    });

    it('asks once on entering a workspace made before names were asked, then never again', async () => {
      const client = fakeClient({ signedIn: true });
      unnamed(client);
      storeSession();
      writeActiveNs('org-1');
      window.history.replaceState(null, '', '/issue-tracker');
      const { unmount } = render(<App deps={deps(client)} />);

      fireEvent.change(await screen.findByTestId('alias-gate-name', {}, SLOW), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByTestId('alias-gate-save'));
      await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith('org-1', 'acct-alice', { name: 'Alice' }), SLOW);
      await waitFor(() => expect(screen.queryByTestId('alias-gate')).toBeNull(), SLOW);
      unmount();

      render(<App deps={deps(client)} />);
      expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
      expect(screen.queryByTestId('alias-gate')).toBeNull();
    });
  });
});

describe('the release the open repo runs (useInstanceRelease)', () => {
  /** Signed in, in the remembered workspace, whose first repo runs `version`. */
  function openRepo(version: string) {
    const client = Object.assign(fakeClient({ signedIn: true }), withRoutes({
      getApp: vi.fn(async () => ({ appId: 'app-1', org: 'org-1' })),
      appsReportAll: vi.fn(async () => ({ apps: [{ app: 'app-1', package: { package: 'com.calimero.issue-tracker', version } }] })),
    }));
    storeSession();
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);
    return client;
  }

  it('moves a served page to the frontend of the release the repo runs, and shows nothing of it meanwhile', async () => {
    release.href = `${HOST}/1.2.0/issue-tracker?assignee=me`;
    openRepo('1.0.0');
    await waitFor(() => expect(release.navigate).toHaveBeenCalledWith(`${HOST}/app/app-1/issue-tracker?assignee=me`), SLOW);
    expect(release.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Login broken')).toBeNull(), SLOW);
  });

  it('stays on a served page of the release the repo runs', async () => {
    release.href = `${HOST}/1.2.0/issue-tracker`;
    const client = openRepo('1.2.0');
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(client.appsReportAll).toHaveBeenCalledWith('org-1'), SLOW);
    await new Promise((r) => setTimeout(r, 0));
    expect(release.navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Login broken')).toBeTruthy();
  });

  it('does nothing in development', async () => {
    const client = openRepo('1.0.0');
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getApp).not.toHaveBeenCalled();
    expect(release.navigate).not.toHaveBeenCalled();
  });
});

describe('the release new repositories are created from', () => {
  /** A client whose newest-release read answers when the test says. */
  function slowRelease(client: ReturnType<typeof fakeClient>) {
    let answer: (v: { latest: string }) => void = () => {};
    client.package.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    return (latest: string) => answer({ latest });
  }

  /** Signed in with no workspace, to the open create dialog (the shared one, stubbed). */
  async function startCreating(client: ReturnType<typeof fakeClient>, env: SessionDeps['env']) {
    client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [] }));
    storeSession(env);
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client, env)} />);
    fireEvent.click(await screen.findByTestId('ns-create-btn', {}, SLOW));
  }

  /** The source the stubbed dialog was handed. */
  const dialogSource = async () => JSON.parse((await screen.findByTestId('create-source', {}, SLOW)).textContent ?? 'null');

  it('opens the shared dialog with the app wording, once the newest release is read', async () => {
    const client = fakeClient({ signedIn: true });
    const answer = slowRelease(client);
    await startCreating(client, UNVERSIONED_ENV);
    expect((await screen.findByTestId('create-pending', {}, SLOW)).textContent).toBe('pending');
    answer('2.0.0');
    expect(await dialogSource()).toEqual({ package: 'com.calimero.mero-issue-tracker', version: '2.0.0' });
    expect(screen.getByTestId('create-title').textContent).toBe('New workspace');
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it('sets the member defaults for an unbound session, and says so when they are refused', async () => {
    const client = fakeClient({ signedIn: true });
    client.setCapabilities.mockRejectedValue(new Error('declined'));
    await startCreating(client, UNVERSIONED_ENV);
    fireEvent.click(await screen.findByTestId('create-done', {}, SLOW));
    await waitFor(() => expect(client.setCapabilities).toHaveBeenCalledTimes(1), SLOW);
    expect(await screen.findByText(/people you invite will not be able to add repositories/, {}, SLOW)).toBeTruthy();
  });

  it('skips the member defaults silently on a session bound to the app', async () => {
    const client = fakeClient({ signedIn: true });
    await startCreating(client, UNVERSIONED_ENV);
    client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [{ orgId: 'org-new', name: 'Platform', role: 'owner' }], app: 'com.calimero.mero-issue-tracker' }));
    fireEvent.click(await screen.findByTestId('create-done', {}, SLOW));
    await waitFor(() => expect(readActiveNs()).toBe('org-new'), SLOW);
    expect(client.setCapabilities).not.toHaveBeenCalled();
    expect(screen.queryByText(/people you invite will not be able/)).toBeNull();
  });

  it('creates a repository from the release that was read', async () => {
    const client = fakeClient({ signedIn: true });
    storeSession(UNVERSIONED_ENV);
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client, UNVERSIONED_ENV)} />);

    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    fireEvent.click(screen.getByTestId('repo-add-btn'));
    fireEvent.change(await screen.findByTestId('repo-add-name', {}, SLOW), { target: { value: 'Renewals' } });
    fireEvent.change(screen.getByTestId('repo-add-url'), { target: { value: 'https://github.com/acme/renewals' } });
    await waitFor(() => expect((screen.getByTestId('repo-add-submit') as HTMLButtonElement).disabled).toBe(false), SLOW);
    fireEvent.click(screen.getByTestId('repo-add-submit'));
    await waitFor(
      () => expect(client.createApp).toHaveBeenCalledWith('Renewals', { package: 'com.calimero.mero-issue-tracker', version: '2.0.0' }, expect.anything()),
      SLOW,
    );
  });

  it('holds adding a repository back until the newest release is read', async () => {
    const client = fakeClient({ signedIn: true });
    const answer = slowRelease(client);
    storeSession(UNVERSIONED_ENV);
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client, UNVERSIONED_ENV)} />);

    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    fireEvent.click(screen.getByTestId('repo-add-btn'));
    fireEvent.change(await screen.findByTestId('repo-add-name', {}, SLOW), { target: { value: 'Renewals' } });
    fireEvent.change(screen.getByTestId('repo-add-url'), { target: { value: 'https://github.com/acme/renewals' } });
    const submit = screen.getByTestId('repo-add-submit') as HTMLButtonElement;
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
    storeSession(UNVERSIONED_ENV);
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client, UNVERSIONED_ENV)} />);

    expect(await screen.findByTestId('ns-create-btn', {}, SLOW)).toBeTruthy();
    expect(screen.queryByTestId('connect-existing-org')).toBeNull();
    expect(screen.getByTestId('release-checking')).toBeTruthy();
    answer('2.0.0');
    expect(await screen.findByTestId('connect-existing-org', {}, SLOW)).toBeTruthy();
    expect(screen.queryByTestId('release-checking')).toBeNull();
  });

  it("does not carry one account's release over to another on the same client", async () => {
    const client = fakeClient({ signedIn: true });
    client.me.mockImplementation(async () => ({ accountId: 'acct-alice', orgs: [] }));
    storeSession(UNVERSIONED_ENV);
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client, UNVERSIONED_ENV)} />);
    fireEvent.click(await screen.findByTestId('logout-btn', {}, SLOW));
    await screen.findAllByRole('button', { name: 'Sign in' }, SLOW);

    const answer = slowRelease(client);
    client.signIn.mockImplementation((async () => {
      const bob = { ...SESSION, accountId: 'acct-bob' };
      client.useSession(bob);
      return bob;
    }) as never);
    await openSignIn();
    fireEvent.click(await screen.findByTestId('signin-passkey', {}, SLOW));
    fireEvent.click(await screen.findByTestId('ns-create-btn', {}, SLOW));
    expect((await screen.findByTestId('create-pending', {}, SLOW)).textContent).toBe('pending');
    answer('3.0.0');
    expect(await dialogSource()).toEqual({ package: 'com.calimero.mero-issue-tracker', version: '3.0.0' });
  });


});

describe('the node shield', () => {
  const NODE = 'https://node-1.example.net';
  const state = () => ({ status: 'verified', url: NODE, mock: false, release: '2.3.148', profile: 'locked-read-only', checkedAt: Date.now() });

  /** Signed in, in the remembered workspace, on a node whose own check passes. */
  function openWorkspace() {
    const client = Object.assign(fakeClient({ signedIn: true }), {
      nodeUrl: NODE,
      verification: state,
      verify: async () => state(),
      attestApp: vi.fn(async () => ({ url: NODE, mock: false, checkedAt: 1, appHash: 'bundle-hash' })),
    });
    storeSession();
    writeActiveNs('org-1');
    window.history.replaceState(null, '', '/issue-tracker');
    render(<App deps={deps(client)} />);
    return client;
  }

  it('sits in the header just left of the theme switch, and is the only shield on the page', async () => {
    openWorkspace();
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    const header = document.querySelector('header')!;
    const shield = within(header).getByTestId('node-shield');
    expect(screen.getAllByTestId('node-shield')).toHaveLength(1);
    expect(shield.compareDocumentPosition(screen.getByTestId('theme-toggle')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('tells the shield which repo is open, so its popover checks that app code', async () => {
    const client = openWorkspace();
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    fireEvent.click(screen.getByTestId('node-shield'));
    const popover = await screen.findByTestId('node-shield-popover', {}, SLOW);
    expect(await within(popover).findByText('App code', {}, SLOW)).toBeTruthy();
    expect(client.attestApp).toHaveBeenCalledWith('app-1', client.nodeUrl);
  });

  it('shows the header shield as its icon alone at 1100px and narrower', async () => {
    const at = (width: number) =>
      ((query: string) => ({
        matches: query === `(max-width: ${width}px)`,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
    window.matchMedia = at(1100);
    openWorkspace();
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    expect(within(document.querySelector('header')!).getByTestId('node-shield').parentElement!.classList.contains('mero-node-shield--compact')).toBe(true);
  });

  it('keeps the header shield\'s label above 1100px', async () => {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    openWorkspace();
    expect(await screen.findByText('Login broken', {}, SLOW)).toBeTruthy();
    expect(within(document.querySelector('header')!).getByTestId('node-shield').parentElement!.classList.contains('mero-node-shield--compact')).toBe(false);
  });

  /** The open repo `app-1` runs `version`, as its scope's report says. */
  function running(client: ReturnType<typeof openWorkspace>, version: string) {
    return Object.assign(client, {
      getApp: vi.fn(async () => ({ appId: 'app-1', org: 'org-1' })),
      appsReportAll: vi.fn(async () => ({ apps: [{ app: 'app-1', package: { package: 'com.calimero.mero-issue-tracker', version } }] })),
      packageCapabilities: vi.fn(async () => {
        throw new Error('no card in this test');
      }),
    });
  }

  it('opens the trust page from the sidebar for the release the open repo runs, with the sidebar item current', async () => {
    const client = running(openWorkspace(), '1.3.0');
    const link = await screen.findByTestId('nav-trust', {}, SLOW);
    expect(link.getAttribute('aria-current')).toBeNull();
    fireEvent.click(link);
    expect(await screen.findByText('com.calimero.mero-issue-tracker v1.3.0', {}, SLOW)).toBeTruthy();
    expect(window.location.pathname).toBe('/issue-tracker/trust');
    expect(screen.getByTestId('nav-trust').getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(client.packageCapabilities).toHaveBeenCalledWith('com.calimero.mero-issue-tracker', '1.3.0'), SLOW);
  });

  it('has one Trust title on the trust page, and says which repository it covers', async () => {
    running(openWorkspace(), '1.3.0');
    fireEvent.click(await screen.findByTestId('nav-trust', {}, SLOW));
    await screen.findByText('com.calimero.mero-issue-tracker v1.3.0', {}, SLOW);
    expect(screen.getAllByRole('heading', { name: 'Trust' })).toHaveLength(1);
    expect(within(document.querySelector('header')!).queryByText('Trust')).toBeNull();
    expect(screen.getByText(/for the repository web/)).toBeTruthy();
  });

  it('says the release could not be read when the node cannot report it', async () => {
    openWorkspace();
    fireEvent.click(await screen.findByTestId('nav-trust', {}, SLOW));
    expect(await screen.findByText('The release this app runs could not be read.', {}, SLOW)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
