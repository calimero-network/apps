import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppInfo, CalimeroClient, CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget, type Target } from '@calimero-apps/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { captureInvite } from './lobbies';
import { APP, type SessionDeps } from './session';

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
    invite: vi.fn(async () => 'tok-123'),
    redeemInvite: vi.fn(async () => ({})),
  };
}

function deps(client: ReturnType<typeof fakeClient>, env: SessionDeps['env'] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

function at(path: string) {
  window.history.replaceState(null, '', path);
}

function signedIn() {
  new SessionStore(APP, LOCAL, localStorage).save(SESSION);
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('App', () => {
  it('says why a production build cannot connect', async () => {
    at('/lobby');
    render(<App deps={deps(fakeClient(), { DEV: false })} />);
    await screen.findByText(/VITE_CALIMERO_CLUSTER is not set/);
  });

  it('signs up with a passkey, then creates a lobby in a new organization', async () => {
    at('/lobby');
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText('Create a passkey'));
    await waitFor(() => expect(client.signUp).toHaveBeenCalled());
    expect(client.signUp.mock.calls[0]?.[1]).toBe('');

    fireEvent.change(await screen.findByPlaceholderText('Lobby name'), { target: { value: 'Friday game' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(client.createApp).toHaveBeenCalled());
    expect(client.createOrg).toHaveBeenCalledWith('Friday game');
    expect(client.createApp).toHaveBeenCalledWith('Friday game', 'bundle-hash', { org: 'org-new' });
    expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' });
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

  it('invites with an org invitation link that names the lobby', async () => {
    signedIn();
    at('/lobby?id=app-1');
    const client = fakeClient([LOBBY]);
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText('Invite player'));
    const link = await screen.findByTestId('invite-link');
    expect(client.invite).toHaveBeenCalledWith('org-1', 'member', expect.anything());
    const url = new URL(link.textContent ?? '');
    expect(url.searchParams.get('invite')).toBe('tok-123');
    expect(url.searchParams.get('lobby')).toBe('app-1');
  });

  it('redeems an invitation opened before signing in, then opens its lobby', async () => {
    at('/lobby?invite=tok-9&lobby=app-1');
    captureInvite();
    expect(window.location.search).toBe('');
    signedIn();
    const client = fakeClient([LOBBY]);
    render(<App deps={deps(client)} />);
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith('tok-9'));
    await waitFor(() => expect(client.call).toHaveBeenCalledWith('app-1', 'registerPlayer', {}));
    expect(localStorage.getItem(`${APP}:pending-invite`)).toBeNull();
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
