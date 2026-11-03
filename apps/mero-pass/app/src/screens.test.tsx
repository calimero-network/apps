import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalimeroClient } from '@calimero-network/mero-js';

import { type Calimero, CalimeroContext } from './calimero';
import InvitationPrompt from './components/InvitationPrompt';
import SignInDialog from './components/SignInDialog';
import TeamsPage from './pages/teams/TeamsPage';
import { MEMBER_DEFAULTS, PERSONAL } from './lib/vaults';

// The screens against a mocked `CalimeroClient`: what they list, and what they
// send when someone presses a button.

function fakeClient() {
  return {
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
    redeemInvite: vi.fn(async () => ({ org: 'org1' })),
  };
}

function calimero(
  client: ReturnType<typeof fakeClient> | null,
  extra: Partial<Calimero> = {},
): Calimero {
  return {
    status: client ? 'signed-in' : 'signed-out',
    client: client as unknown as CalimeroClient,
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

  it('creates a team as an org and opens it', async () => {
    const client = fakeClient();
    renderAt('/teams', calimero(client), <TeamsPage />);
    await screen.findByTestId('team-grid');
    fireEvent.change(screen.getByTestId('team-name'), {
      target: { value: 'Ops' },
    });
    fireEvent.click(screen.getByTestId('team-create'));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/teams/org9'),
    );
    expect(client.createOrg).toHaveBeenCalledWith('Ops');
    expect(client.setCapabilities).toHaveBeenCalledWith(
      'org9',
      MEMBER_DEFAULTS,
      {},
    );
  });
});

describe('InvitationPrompt', () => {
  it('waits for a session, then joins the team the invite names', async () => {
    localStorage.setItem('mero-pass:pending-invite', 'tok');
    const { rerender } = renderAt('/', calimero(null), <InvitationPrompt />);
    expect(screen.queryByTestId('invitation-prompt')).not.toBeInTheDocument();

    const client = fakeClient();
    rerender(
      <CalimeroContext.Provider value={calimero(client)}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <InvitationPrompt />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </CalimeroContext.Provider>,
    );
    fireEvent.click(await screen.findByTestId('invitation-join'));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/teams/org1'),
    );
    expect(client.redeemInvite).toHaveBeenCalledWith('tok');
    expect(localStorage.getItem('mero-pass:pending-invite')).toBeNull();
  });

  it('lets an invitation go without joining', async () => {
    localStorage.setItem('mero-pass:pending-invite', 'tok');
    const client = fakeClient();
    renderAt('/', calimero(client), <InvitationPrompt />);
    fireEvent.click(await screen.findByTestId('invitation-dismiss'));
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem('mero-pass:pending-invite')).toBeNull();
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

  it('signs in with a passkey, or signs up with a name', () => {
    const value = calimero(null);
    renderAt('/', value, <SignInDialog open onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('sign-in-passkey'));
    expect(value.signIn).toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('sign-up-name'), {
      target: { value: 'Ada' },
    });
    fireEvent.click(screen.getByTestId('sign-up'));
    expect(value.signUp).toHaveBeenCalledWith('Ada');
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
});
