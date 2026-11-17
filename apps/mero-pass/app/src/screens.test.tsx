import { CalimeroError } from '@calimero-network/mero-js';
import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Calimero, CalimeroContext } from './calimero';
import InvitationPrompt from './components/InvitationPrompt';
import SignInDialog from './components/SignInDialog';
// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock('@calimero-network/mero-react', async (importOriginal) => {
  const { createElement } = await import('react');
  return {
    ...(await importOriginal<object>()),
    AcceptInviteDialog: (p: { open: boolean; token: string; org?: string; appName?: string; labels?: { noun?: string }; onClose: () => void; onError?: (e: unknown) => void; onJoined: (j: { org: string }) => void }) =>
      p.open
        ? createElement(
            'div',
            { 'data-testid': 'accept-dialog' },
            createElement('p', { 'data-testid': 'accept-token' }, `${p.token} ${p.appName}`),
            createElement('p', { 'data-testid': 'accept-extra' }, JSON.stringify({ org: p.org, noun: p.labels?.noun })),
            createElement('button', { 'data-testid': 'accept-join', onClick: () => p.onJoined({ org: 'org1' }) }, 'join'),
            createElement('button', { 'data-testid': 'accept-close', onClick: p.onClose }, 'close'),
            createElement('button', { 'data-testid': 'accept-spent', onClick: () => p.onError?.(new CalimeroError(400, 'REJECTED', 'unknown invite')) }, 'spent'),
            createElement('button', { 'data-testid': 'accept-offline', onClick: () => p.onError?.(new CalimeroError(503, 'UNAVAILABLE', 'node unreachable')) }, 'offline'),
          )
        : null,
    InviteDialog: (p: { open: boolean; org: string; teams?: string[]; linkBase?: string; appName?: string; uses?: number; ttlSecs?: number; expiryOptions?: number[]; labels?: { noun?: string; title?: string; note?: string } }) =>
      p.open
        ? createElement(
            'pre',
            { 'data-testid': 'invite-dialog' },
            JSON.stringify({ org: p.org, teams: p.teams, linkBase: p.linkBase, appName: p.appName, title: p.labels?.title, noun: p.labels?.noun, note: p.labels?.note, uses: p.uses, ttlSecs: p.ttlSecs, expiryOptions: p.expiryOptions }),
          )
        : null,
    CreateWorkspaceDialog: (p: {
      open: boolean;
      defaultSelfName?: string;
      release: unknown;
      labels?: { title?: string };
      onCreated: (w: { orgId: string; name: string; selfName: string }) => void;
    }) =>
      p.open
        ? createElement(
            'div',
            { 'data-testid': 'create-dialog' },
            createElement('h2', { 'data-testid': 'create-title' }, p.labels?.title),
            createElement('p', { 'data-testid': 'create-self' }, p.defaultSelfName),
            createElement('pre', { 'data-testid': 'create-release' }, JSON.stringify(p.release)),
            createElement(
              'button',
              { 'data-testid': 'create-done', onClick: () => p.onCreated({ orgId: 'org9', name: 'Ops', selfName: 'Ana' }) },
              'done',
            ),
          )
        : null,
  };
});

import TeamsPage from './pages/teams/TeamsPage';
import { MEMBER_DEFAULTS, PERSONAL } from './lib/vaults';
import { invites } from './lib/inviteLink';
import { withRoutes } from '@calimero-apps/connect/testing';

/** Hold `token` as the pending invite, as a captured link would. */
function hold(token: string, org: string | null = null) {
  invites.put({ token, org, team: null, doc: null, route: null, extra: {} });
}

// The screens against a mocked `CalimeroClient`: what they list, and what they
// send when someone presses a button.

function fakeClient() {
  return withRoutes({
    me: vi.fn(async () => ({
      accountId: 'me',
      name: 'Me',
      orgs: [
        { orgId: 'org1', name: 'Acme', role: 'owner' },
        { orgId: 'org2', name: 'Private', role: 'owner' },
      ],
    })),
    getOrg: vi.fn(async (org: string) =>
      org === 'org2'
        ? {
            name: 'Private',
            members: { me: 'owner' },
            metadata: PERSONAL,
            teams: {},
          }
        : {
            name: 'Acme',
            members: { me: 'owner', bob: 'member' },
            defaultCapabilities: MEMBER_DEFAULTS,
            teams: {},
          },
    ),
    listApps: vi.fn(async () => [
      {
        appId: 'open1',
        name: 'Shared',
        owner: 'me',
        org: 'org1',
        bundle: 'b',
        package: null,
        version: null,
      },
      {
        appId: 'mine1',
        name: 'Private',
        owner: 'me',
        org: 'org2',
        bundle: 'b',
        package: null,
        version: null,
      },
    ]),
    getApp: vi.fn(async () => ({ access: { kind: 'org' } })),
    createOrg: vi.fn(async () => 'org9'),
    setCapabilities: vi.fn(async () => {}),
    setMemberMetadata: vi.fn(async () => {}),
    setOrgMetadata: vi.fn(async () => {}),
    createApp: vi.fn(async () => 'app9'),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
  });
}

function calimero(
  client: ReturnType<typeof fakeClient> | null,
  extra: Partial<Calimero> = {},
): Calimero {
  return {
    status: client ? 'signed-in' : 'signed-out',
    client: (client ? withRoutes(client) : null) as never,
    target: { kind: 'local', nodes: ['http://127.0.0.1:2501'] } as never,
    accountId: client ? 'me' : null,
    source: 'bundle-hash',
    message: null,
    error: null,
    busy: false,
    isAuthenticated: !!client,
    isLoading: false,
    where: 'merod local (1 node)',
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    passkey: () => ({}) as never,
    after: () => {},
    ...extra,
  };
}

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderAt(path: string, value: Calimero, element: ReactElement) {
  return render(
    <CalimeroContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {element}
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </CalimeroContext.Provider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('TeamsPage', () => {
  it('shows the private vault apart from the teams, with their counts', async () => {
    const client = fakeClient();
    renderAt('/teams', calimero(client), <TeamsPage />);
    const grid = await screen.findByTestId('team-grid');
    expect(grid).toHaveTextContent('Acme');
    expect(grid).toHaveTextContent('1 vault');
    expect(grid).toHaveTextContent('2 members');
    expect(screen.getByTestId('personal-card')).toHaveTextContent('Private');
    expect(client.listApps).toHaveBeenCalledWith({ bundle: 'bundle-hash' });

    fireEvent.click(screen.getByTestId('personal-card'));
    expect(screen.getByTestId('where')).toHaveTextContent('/vault/mine1');
  });

  it('sets up the team the dialog made and opens it', async () => {
    const client = fakeClient();
    renderAt('/teams', calimero(client), <TeamsPage />);
    await screen.findByTestId('team-grid');
    fireEvent.click(screen.getByTestId('team-create'));
    expect(await screen.findByTestId('create-title')).toHaveTextContent('New team');
    expect(JSON.parse(screen.getByTestId('create-release').textContent ?? 'null')).toEqual({ package: 'com.calimero.mero-pass' });
    fireEvent.click(screen.getByTestId('create-done'));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/teams/org9'),
    );
    expect(client.createOrg).not.toHaveBeenCalled();
    expect(client.setMemberMetadata).toHaveBeenCalledWith('org9', 'me', { name: 'Ana' });
    expect(client.setCapabilities).toHaveBeenCalledWith(
      'org9',
      MEMBER_DEFAULTS,
      expect.objectContaining({ confirm: expect.any(Function) }),
    );
  });

  it('creates the private vault through the dialog too, in an org marked personal', async () => {
    const client = fakeClient();
    client.me.mockImplementation(async () => ({ accountId: 'me', name: 'Me', orgs: [{ orgId: 'org1', name: 'Acme', role: 'owner' }] }));
    renderAt('/teams', calimero(client), <TeamsPage />);
    fireEvent.click(await screen.findByTestId('personal-create'));
    expect(await screen.findByTestId('create-title')).toHaveTextContent('Private vault');
    fireEvent.click(screen.getByTestId('create-done'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/vault/app9'));
    expect(client.setOrgMetadata).toHaveBeenCalledWith('org9', PERSONAL);
    expect(client.createOrg).not.toHaveBeenCalled();
  });

  it('Invite someone opens the shared dialog for that team, with a link naming it', async () => {
    renderAt('/teams', calimero(fakeClient()), <TeamsPage />);
    fireEvent.click((await screen.findAllByTestId('team-menu'))[0]!);
    fireEvent.click(await screen.findByText('Invite someone'));
    const shown = JSON.parse((await screen.findByTestId('invite-dialog')).textContent ?? '');
    expect(shown).toMatchObject({
      org: 'org1',
      teams: [],
      appName: 'Hyperfeed Pass',
      title: 'Invite to Acme',
      noun: 'team',
      uses: 1,
      ttlSecs: 86400,
      expiryOptions: [3600, 86400, 604800],
    });
    expect(shown.note).toBeUndefined();
    expect(Object.fromEntries(new URL(shown.linkBase).searchParams)).toEqual({ org: 'org1' });
  });
});

const APP_BODY = <p data-testid="app-body">app</p>;

function promptAt(path: string, value: Calimero) {
  return renderAt(path, value, <InvitationPrompt>{APP_BODY}</InvitationPrompt>);
}

describe('InvitationPrompt', () => {
  it('shows a signed-out visitor an invitation page instead of the app, with the passkey sign-in', async () => {
    hold('tok');
    promptAt('/', calimero(null));
    const page = await screen.findByTestId('invitation-page');
    expect(page).toHaveTextContent("You're invited");
    expect(page).toHaveTextContent(
      "You've been invited to join the team in Hyperfeed Pass.",
    );
    expect(screen.getByTestId('signin-passkey')).toBeInTheDocument();
    expect(screen.queryByTestId('app-body')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('"Not now" shows the app and keeps the invitation', async () => {
    hold('tok');
    promptAt('/', calimero(null));
    fireEvent.click(await screen.findByTestId('invitation-later'));
    expect(screen.getByTestId('app-body')).toBeInTheDocument();
    expect(invites.token()).toBe('tok');
  });

  it('asks to join as soon as the session exists, then joins the team the invite names', async () => {
    hold('tok');
    const { rerender } = promptAt('/', calimero(null));
    expect(screen.queryByTestId('accept-dialog')).not.toBeInTheDocument();

    const client = fakeClient();
    rerender(
      <CalimeroContext.Provider value={calimero(client)}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <InvitationPrompt>{APP_BODY}</InvitationPrompt>
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </CalimeroContext.Provider>,
    );
    expect(await screen.findByTestId('accept-token')).toHaveTextContent('tok Hyperfeed Pass');
    fireEvent.click(screen.getByTestId('accept-join'));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/teams/org1'),
    );
    expect(invites.token()).toBeNull();
  });

  it('lets an invitation go without joining', async () => {
    hold('tok');
    const client = fakeClient();
    promptAt('/', calimero(client));
    fireEvent.click(await screen.findByTestId('accept-close'));
    expect(invites.token()).toBeNull();
  });

  it('hands the dialog the invite\'s team, so a member is told so; continuing opens the team', async () => {
    hold('tok', 'org1');
    const client = fakeClient();
    promptAt('/', calimero(client));
    expect(JSON.parse((await screen.findByTestId('accept-extra')).textContent ?? 'null')).toEqual({ org: 'org1', noun: 'team' });
    expect(screen.queryByTestId('invitation-outcome')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('accept-join'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/teams/org1'));
    expect(invites.token()).toBeNull();
  });

  it('drops a stored token the node says is spent, and keeps it for a network failure', async () => {
    hold('tok');
    promptAt('/', calimero(fakeClient()));
    fireEvent.click(await screen.findByTestId('accept-offline'));
    expect(invites.token()).toBe('tok');
    fireEvent.click(screen.getByTestId('accept-spent'));
    expect(invites.token()).toBeNull();
  });
});

describe('SignInDialog', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function (
      this: HTMLDialogElement,
    ) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  it('signs in with a passkey, or signs up without asking a name (a team asks for it)', () => {
    const value = calimero(null);
    renderAt('/', value, <SignInDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('signin-passkey'));
    expect(value.signIn).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('signup-passkey'));
    expect(screen.queryByTestId('signup-name')).toBeNull();
    expect(value.signUp).toHaveBeenCalled();
  });

  it('says why when the build has no cluster to connect to', () => {
    renderAt(
      '/',
      calimero(null, {
        status: 'unconfigured',
        message: 'VITE_CALIMERO_CLUSTER is required',
      }),
      <SignInDialog open onClose={() => {}} />,
    );
    expect(screen.getByTestId('sign-in-unconfigured')).toHaveTextContent(
      'VITE_CALIMERO_CLUSTER',
    );
  });

  it('shows the listing on a copy no cluster serves', () => {
    renderAt(
      '/',
      calimero(null, {
        status: 'listing',
        message: "This is mero-pass's listing page",
      }),
      <SignInDialog open onClose={() => {}} />,
    );
    // The node-served copy: mdma's `app_host.app_url('com.calimero.mero-pass')`.
    expect(
      screen.getByRole('link', { name: 'Open Hyperfeed Pass' }),
    ).toHaveAttribute(
      'href',
      'https://cnnfhhpjf6fjrjmxlf76yeqjhfz43my7vfvzo2bpvod7hzokzlqa.apps.calimero.network/',
    );
    expect(screen.queryByTestId('sign-in-unconfigured')).toBeNull();
  });
});
