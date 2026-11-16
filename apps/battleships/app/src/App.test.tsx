import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type AppInfo, type CalimeroSession } from '@calimero-network/mero-js';
import {
  SessionStore,
  createInviteStore,
  resolveTarget,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
  type Target,
} from '@calimero-apps/connect';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { invites as appInvites, migrateStoredInvite } from './lobbies';
import { APP, type SessionDeps } from './session';
import { withRoutes } from '@calimero-apps/connect/testing';

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
            createElement('h2', { 'data-testid': 'create-title' }, p.labels?.title),
            createElement('pre', { 'data-testid': 'create-release' }, JSON.stringify(p.release)),
            createElement(
              'button',
              { 'data-testid': 'create-done', onClick: () => void p.onCreated({ orgId: 'org-new', name: 'Friday game', selfName: 'Ada' }) },
              'done',
            ),
          )
        : null,
    InviteDialog: (p: Parameters<typeof actual.InviteDialog>[0]) =>
      p.open
        ? createElement(
            'div',
            { 'data-testid': 'invite-dialog' },
            createElement('h2', { 'data-testid': 'invite-title' }, p.labels?.title),
            createElement('pre', { 'data-testid': 'invite-props' }, JSON.stringify({ org: p.org, role: p.role, teams: p.teams, linkBase: p.linkBase, noun: p.labels?.noun, inviterName: p.inviterName })),
          )
        : null,
    AcceptInviteDialog: (p: Parameters<typeof actual.AcceptInviteDialog>[0]) =>
      p.open
        ? createElement(
            'div',
            { 'data-testid': 'accept-dialog' },
            createElement('pre', { 'data-testid': 'accept-token' }, p.token),
            createElement('pre', { 'data-testid': 'accept-props' }, JSON.stringify({ org: p.org, labels: p.labels })),
            createElement('button', { 'data-testid': 'accept-fail', onClick: () => p.onError?.(new Error('spent')) }, 'fail'),
            createElement('button', { 'data-testid': 'accept-join', onClick: () => p.onJoined({ org: 'org-9', alreadyMember: false }) }, 'join'),
            createElement('button', { 'data-testid': 'accept-member', onClick: () => p.onJoined({ org: 'org-9', alreadyMember: true }) }, 'member'),
            createElement('button', { 'data-testid': 'accept-close', onClick: p.onClose }, 'close'),
          )
        : null,
  };
});

const SESSION: CalimeroSession = { accountId: 'acct-alice', sessionToken: 's', refreshToken: 'r', expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };
const LOCAL: Target = resolveTarget(DEV_ENV);

const LOBBY: AppInfo = {
  appId: 'app-1',
  name: 'Harbour',
  owner: 'acct-alice',
  org: 'org-1',
  bundle: 'bundle-hash',
  package: null,
  version: null,
};

const STATE = {
  standing: 'playing',
  committed: [],
  pending_shot: null,
  ended_by: null,
  loser: null,
  revealed: [],
  audit_failed: [],
  winner: null,
};

/** The answers of the contract's views, by method. */
function views(method: string): unknown {
  switch (method) {
    case 'getPlayers':
      return [
        { account: 'acct-alice', player: 'acct-alice' },
        { account: 'acct-bob', player: 'acct-bob' },
      ];
    case 'getMatches':
    case 'getHistory':
      return [];
    case 'getMatchState':
      return STATE;
    case 'getShots':
    case 'getIncomingShots':
      return { size: 10, shots: new Array(100).fill(0) };
    case 'getCurrentTurn':
      return 'acct-alice';
    default:
      return null;
  }
}

function fakeClient(apps: AppInfo[] = []) {
  let session: CalimeroSession | undefined;
  return {
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
    signUp: vi.fn(async (_passkey: unknown, _name: string) => {
      session = SESSION;
      return SESSION;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    listApps: vi.fn(async () => apps),
    createOrg: vi.fn(async () => 'org-new'),
    createApp: vi.fn(async (name: string) => {
      apps.push({ ...LOBBY, appId: 'app-new', name, org: 'org-new' });
      return 'app-new';
    }),
    getOrg: vi.fn(async () => ({
      members: { 'acct-alice': 'owner', 'acct-bob': 'member' },
      memberMetadata: { 'acct-bob': { name: 'Bob' } },
    })),
    setMemberMetadata: vi.fn(async () => undefined),
    call: vi.fn(async (_app: string, method: string, _args?: unknown) => ({
      index: 2,
      result: (method === 'createMatch' ? 'acct-alice-1-ab' : method === 'registerPlayer' ? 'acct-alice' : null) as unknown,
      events: [],
    })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: views(method) })),
    events: vi.fn(async function* () {}),
    me: vi.fn(async () => ({ orgs: [{ orgId: 'org-1', name: 'Harbour', role: 'owner' }] })),
    redeemInvite: vi.fn(async () => ({})),
  };
}

function deps(client: ReturnType<typeof fakeClient>, env: SessionDeps['env'] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

function at(path: string) {
  window.history.replaceState(null, '', path);
}

/** An invite store on `storage` holding `invite`, as `index.tsx` leaves it after capturing a link. */
function pendingIn(invite: Partial<PendingInvite> & { token: string }, storage: KeyValueStorage = localStorage): InviteStore {
  const invites = createInviteStore(APP, { storage, keep: ['lobby'] });
  invites.put({ org: null, team: null, doc: null, route: null, extra: {}, ...invite });
  return invites;
}

/** Bob's lobby, out of reach until the invitation is redeemed. */
const THEIRS: AppInfo = { ...LOBBY, appId: 'app-9', name: 'Bob harbour', owner: 'acct-bob', org: 'org-9' };

function signedIn() {
  new SessionStore(APP, LOCAL, localStorage).save(SESSION);
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('App', () => {
  it('shows the listing on a production copy no cluster serves', async () => {
    at('/lobby');
    render(<App deps={deps(fakeClient(), { DEV: false })} />);
    const open = await screen.findByRole('link', { name: 'Open Battleships' });
    // The node-served copy: mdma's `app_host.app_url('com.calimero.battleships')`.
    expect(open.getAttribute('href')).toBe('https://3dcycf7rhh63uk7zb4bsaic6omvmcxbjuvihojnbfnsfqdaocjfa.apps.calimero.network/');
    expect(screen.getByRole('link', { name: 'Deploy your own on Calimero Cloud' }).getAttribute('href')).toBe(
      'https://cloud.calimero.network/v2',
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it('signs up with a passkey, then creates a lobby in the organization the dialog made', async () => {
    at('/lobby');
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalled());
    expect(client.signUp.mock.calls[0]?.[1]).toBe('');

    fireEvent.click(await screen.findByText('Create a lobby'));
    expect(screen.getByTestId('create-title').textContent).toBe('New lobby');
    fireEvent.click(screen.getByTestId('create-done'));
    await waitFor(() => expect(client.createApp).toHaveBeenCalled());
    expect(client.createOrg).not.toHaveBeenCalled();
    expect(client.setMemberMetadata).toHaveBeenCalled();
    expect(client.createApp).toHaveBeenCalledWith('Friday game', 'bundle-hash', { org: 'org-new' });
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' }));
  });

  it('shows why the lobby could not be made once its organization exists', async () => {
    at('/lobby');
    const client = fakeClient();
    client.createApp.mockRejectedValueOnce(new Error('quota exceeded'));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByText('Create a lobby'));
    fireEvent.click(screen.getByTestId('create-done'));
    expect(await screen.findByText('quota exceeded')).toBeTruthy();
    expect(screen.queryByText('Lobby created')).toBeNull();
  });

  it('opens a lobby: registers, lists the org with names, challenges, and deploys a fleet', async () => {
    signedIn();
    at('/lobby?id=app-1');
    const client = fakeClient([LOBBY]);
    render(<App deps={deps(client)} />);

    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('app-1', 'registerPlayer', {}),
    );
    expect(await screen.findByText('Bob')).toBeVisible();
    expect(client.getOrg).toHaveBeenCalledWith('org-1');

    fireEvent.click(await screen.findByTestId('challenge-player'));
    fireEvent.click(screen.getByText('Challenge', { selector: 'button[type="submit"]' }));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith('app-1', 'createMatch', { player2: 'acct-bob' }),
    );
    // The match is in the lobby's own instance: straight to the placement grid.
    expect(await screen.findByText('Deploy Fleet', { selector: '.naval-card-title' })).toBeVisible();
    await waitFor(() =>
      expect(client.view).toHaveBeenCalledWith('app-1', 'getMatchState', { matchId: 'acct-alice-1-ab' }),
    );
    expect(client.events).toHaveBeenCalledWith('app-1', expect.any(Number), expect.any(AbortSignal));
  });

  it('invites through the shared dialog, with a link base naming the lobby and its org', async () => {
    signedIn();
    at('/lobby?id=app-1');
    const client = fakeClient([LOBBY]);
    client.getOrg.mockResolvedValue({
      members: { 'acct-alice': 'owner', 'acct-bob': 'member' },
      memberMetadata: { 'acct-bob': { name: 'Bob' }, 'acct-alice': { name: 'Alice' } },
    } as never);
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText('Invite player'));
    expect(screen.getByTestId('invite-title').textContent).toBe('Invite to this lobby');
    const props = JSON.parse(screen.getByTestId('invite-props').textContent ?? '');
    expect(props).toMatchObject({ org: 'org-1', noun: 'lobby' });
    const base = new URL(props.linkBase);
    expect(base.searchParams.get('lobby')).toBe('app-1');
    expect(base.searchParams.get('org')).toBe('org-1');
    expect(props.inviterName).toBe('Alice');
    expect(base.searchParams.get('from')).toBe('Alice');
  });

  it('signed out with a pending invite, shows the invitation page instead of the landing page', async () => {
    at('/');
    const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-1' } });
    render(<App deps={deps(fakeClient([LOBBY]))} invites={invites} />);
    expect(await screen.findByTestId('invitation-page')).toBeVisible();
    expect(screen.getByText("You're invited")).toBeVisible();
    expect(screen.getByTestId('invitation-note').textContent).toContain('join the lobby in Battleships');
    expect(document.querySelector('.cal-lp-root')).toBeNull();
  });

  it('signing in on the invitation page asks before joining, then Join opens its lobby', async () => {
    at('/lobby');
    const theirs: AppInfo[] = [THEIRS];
    const client = fakeClient(theirs);
    const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-9' } });
    render(<App deps={deps(client)} invites={invites} />);
    await screen.findByTestId('invitation-page');
    fireEvent.click(screen.getByTestId('signin-passkey'));

    expect((await screen.findByTestId('accept-token')).textContent).toBe('tok-9');
    expect(client.redeemInvite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('accept-join'));
    await waitFor(() => expect(client.call).toHaveBeenCalledWith('app-9', 'registerPlayer', {}));
    expect(invites.token()).toBeNull();
  });

  it('an invited newcomer creates the account and joins in one click, and the lobby opens', async () => {
    at('/lobby');
    const client = fakeClient([LOBBY]);
    const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-1' } });
    render(<App deps={deps(client)} invites={invites} />);
    const create = await screen.findByTestId('signup-passkey');
    expect(create.textContent).toBe('Create your account and join the lobby');
    fireEvent.click(create);
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-9' }));
    await waitFor(() => expect(client.call).toHaveBeenCalledWith('app-1', 'registerPlayer', {}));
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(screen.queryByTestId('accept-dialog')).toBeNull();
    expect(invites.token()).toBeNull();
  });

  it('"Not now" on the invitation page shows the landing page and keeps the token', async () => {
    at('/');
    const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-1' } });
    render(<App deps={deps(fakeClient([LOBBY]))} invites={invites} />);
    fireEvent.click(await screen.findByTestId('invitation-not-now'));
    await waitFor(() => expect(document.querySelector('.cal-lp-root')).not.toBeNull());
    expect(invites.token()).toBe('tok-9');
  });

  describe('an invitation opened by a signed-in player', () => {
    it('asks first: the dialog opens with the token and nothing is redeemed', async () => {
      signedIn();
      at('/lobby');
      const client = fakeClient([LOBBY]);
      const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-9' } });
      render(<App deps={deps(client)} invites={invites} />);
      expect((await screen.findByTestId('accept-token')).textContent).toBe('tok-9');
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBe('tok-9');
    });

    it('Not now joins nothing and forgets the invite', async () => {
      signedIn();
      at('/lobby');
      const client = fakeClient([LOBBY]);
      const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-9' } });
      render(<App deps={deps(client)} invites={invites} />);
      fireEvent.click(await screen.findByTestId('accept-close'));
      await waitFor(() => expect(screen.queryByTestId('accept-dialog')).toBeNull());
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });

    it('Join opens the lobby it joined', async () => {
      signedIn();
      at('/lobby');
      const client = fakeClient([LOBBY, THEIRS]);
      const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-9' } });
      render(<App deps={deps(client)} invites={invites} />);
      fireEvent.click(await screen.findByTestId('accept-join'));
      await waitFor(() => expect(client.call).toHaveBeenCalledWith('app-9', 'registerPlayer', {}));
      expect(invites.token()).toBeNull();
    });

    it('Join says the invitation was accepted', async () => {
      signedIn();
      at('/lobby');
      const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-9' } });
      render(<App deps={deps(fakeClient([LOBBY, THEIRS]))} invites={invites} />);
      fireEvent.click(await screen.findByTestId('accept-join'));
      expect(await screen.findByText('Invitation accepted')).toBeTruthy();
    });

    it('Continue as an existing member claims no acceptance', async () => {
      signedIn();
      at('/lobby');
      const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-9' } });
      render(<App deps={deps(fakeClient([LOBBY, THEIRS]))} invites={invites} />);
      fireEvent.click(await screen.findByTestId('accept-member'));
      expect(await screen.findByText("You're already in this lobby")).toBeTruthy();
      expect(screen.queryByText('Invitation accepted')).toBeNull();
    });

    it('hands the dialog the link\'s org and wording, so the dialog skips a member', async () => {
      signedIn();
      at('/lobby');
      const client = fakeClient([LOBBY]);
      const invites = pendingIn({ token: 'tok-9', org: 'org-1', extra: { lobby: 'app-1', from: 'Ada' } });
      render(<App deps={deps(client)} invites={invites} />);
      const props = JSON.parse((await screen.findByTestId('accept-props')).textContent ?? '');
      expect(props.org).toBe('org-1');
      expect(props.labels).toMatchObject({ title: "Join Ada's game", join: 'Join' });
      expect(props.labels.body).toContain("Ada's game");
      expect(client.redeemInvite).not.toHaveBeenCalled();
    });

    it('a refused join forgets the token but keeps the dialog on screen', async () => {
      signedIn();
      at('/lobby');
      const invites = pendingIn({ token: 'tok-9', extra: { lobby: 'app-9' } });
      render(<App deps={deps(fakeClient([LOBBY]))} invites={invites} />);
      fireEvent.click(await screen.findByTestId('accept-fail'));
      await waitFor(() => expect(invites.token()).toBeNull());
      expect(screen.getByTestId('accept-dialog')).toBeVisible();
      fireEvent.click(screen.getByTestId('accept-close'));
      await waitFor(() => expect(screen.queryByTestId('accept-dialog')).toBeNull());
    });

    it('signing out drops the pending invite, so the next person is not asked to join', async () => {
      signedIn();
      at('/lobby');
      const client = fakeClient([LOBBY]);
      const invites = pendingIn({ token: 'tok-9' });
      render(<App deps={deps(client)} invites={invites} />);
      await screen.findByTestId('accept-dialog');
      fireEvent.click(screen.getByText('Logout'));
      await waitFor(() => expect(client.signOut).toHaveBeenCalled());
      await waitFor(() => expect(invites.token()).toBeNull());
      await waitFor(() => expect(document.querySelector('.cal-lp-root')).not.toBeNull());
      expect(screen.queryByTestId('invitation-page')).toBeNull();
      expect(client.redeemInvite).not.toHaveBeenCalled();
    });
  });

  it('captures a link into the shared store, and moves one an older build stored', () => {
    at('/lobby?invite=tok-9&lobby=app-1');
    expect(appInvites.capture(window.location)).toMatchObject({ token: 'tok-9', extra: { lobby: 'app-1' } });
    expect(window.location.search).toBe('');
    appInvites.drop();

    const storage = new Map<string, string>();
    const old: KeyValueStorage = {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    };
    old.setItem(`${APP}:pending-invite`, JSON.stringify({ token: 'tok-old', lobby: 'app-9', org: 'org-9' }));
    const store = createInviteStore(APP, { storage: old, keep: ['lobby'] });
    migrateStoredInvite(store, old);
    expect(store.pending()).toMatchObject({ token: 'tok-old', org: 'org-9', extra: { lobby: 'app-9' } });
    expect(old.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it('saves a display name in the lobby organization', async () => {
    signedIn();
    at('/lobby?id=app-1');
    const client = fakeClient([LOBBY]);
    render(<App deps={deps(client)} />);
    fireEvent.change(await screen.findByPlaceholderText('How other players see you'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(client.setMemberMetadata).toHaveBeenCalledWith('org-1', 'acct-alice', { name: 'Alice' }),
    );
  });
});
