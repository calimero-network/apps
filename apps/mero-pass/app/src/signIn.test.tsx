import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalimeroError, type PasskeyProvider } from '@calimero-network/mero-js';
import { resolveTarget } from '@calimero-apps/connect';
import { SIGN_IN_HINT, accountHintKey, noAccountCopy } from '@calimero-apps/passkey';

import { CalimeroProvider, useCalimero, type CalimeroDeps } from './calimero';
import SignInPanel from './components/SignInPanel';
import InvitationPrompt from './components/InvitationPrompt';
import { invites } from './lib/inviteLink';
import { withRoutes } from '@calimero-apps/connect/testing';

// The sign-in every component app shares (@calimero-apps/passkey): only this
// cluster's passkeys, "no account here" as create-in-place, Sign in first for
// an invited person with an account, and the invite carried at sign-up.

const ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };

function setup(configure?: (client: ReturnType<typeof fakeClient>) => void) {
  const pk = {
    create: vi.fn(async () => ({}) as never),
    get: vi.fn(async (..._args: unknown[]) => ({ credentialId: 'cred-here' }) as never),
  };
  const client = fakeClient();
  configure?.(client);
  const deps: CalimeroDeps = {
    env: ENV,
    makeClient: async () => withRoutes(client),
    passkey: () => pk as unknown as PasskeyProvider,
  };
  function Status() {
    const { status } = useCalimero();
    return <p data-testid="status">{status}</p>;
  }
  render(
    <CalimeroProvider deps={deps}>
      <SignInPanel />
      <Status />
    </CalimeroProvider>,
  );
  return { pk, client };
}

function fakeClient() {
  const client = withRoutes({
    session: undefined as undefined | { accountId: string },
    useSession: vi.fn(),
    signOut: vi.fn(async () => {}),
    me: vi.fn(async () => ({ orgs: [{ orgId: 'org-1' }] })),
    signIn: vi.fn(async (p: PasskeyProvider) => {
      await p.get(new Uint8Array([1]), 'calimero.network');
      (client as { session: unknown }).session = { accountId: 'acct-1' };
      return client.session;
    }),
    signUp: vi.fn(async (..._args: unknown[]) => {
      (client as { session: unknown }).session = { accountId: 'acct-new' };
      return client.session;
    }),
  });
  return client;
}

const signedIn = () =>
  waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

beforeEach(() => {
  localStorage.clear();
  invites.drop();
});

describe('one sign-in everywhere', () => {
  it('a sign-in offers only the passkeys that worked on this cluster', async () => {
    const first = setup();
    fireEvent.click(await screen.findByTestId('signin-passkey'));
    await signedIn();
    expect(first.pk.get.mock.calls[0]?.[2]).toBeUndefined();
    cleanup();
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('calimero-session:')) localStorage.removeItem(key);
    }

    const again = setup();
    fireEvent.click(await screen.findByTestId('signin-passkey'));
    await signedIn();
    expect(again.pk.get.mock.calls[0]?.[2]).toEqual(['cred-here']);
  });

  it('says which passkeys work here', async () => {
    setup();
    expect(await screen.findByText(SIGN_IN_HINT)).toBeInTheDocument();
  });

  it('an invited sign-in the cluster has no account for switches to creating one, in place', async () => {
    invites.put({ token: 'tok-1', org: null, team: null, doc: null, route: null, extra: {} });
    setup((client) =>
      client.signIn.mockRejectedValue(
        new CalimeroError(401, 'PASSKEY_UNKNOWN_HERE', 'unknown passkey'),
      ),
    );
    fireEvent.click(await screen.findByTestId('signin-passkey'));
    expect(await screen.findByTestId('signin-switched')).toHaveTextContent(
      noAccountCopy('the team', true),
    );
    expect(screen.getByTestId('signup-passkey')).toHaveTextContent(
      'Create your account and join the team',
    );
    expect(screen.queryByTestId('signin-error')).toBeNull();
  });

  it('an invited person who has signed in here before sees Sign in first', async () => {
    invites.put({ token: 'tok-1', org: null, team: null, doc: null, route: null, extra: {} });
    localStorage.setItem(accountHintKey(resolveTarget(ENV)), '1');
    setup();
    expect(await screen.findByTestId('signin-passkey')).toHaveTextContent(
      'Join the team with your passkey',
    );
  });

  it('a sign-up carries the invite on an open cluster and joins in that step', async () => {
    invites.put({ token: 'tok-1', org: null, team: null, doc: null, route: null, extra: {} });
    const { client } = setup();
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByTestId('signup-passkey')); // past the optional name
    await signedIn();
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', {
      invite: 'tok-1',
    });
    expect(invites.token()).toBeNull();
  });

  it('an invited newcomer who creates the account lands in the team the invite joined (B10)', async () => {
    invites.put({ token: 'tok-1', org: 'org-1', team: null, doc: null, route: null, extra: {} });
    const client = fakeClient();
    const deps: CalimeroDeps = {
      env: ENV,
      makeClient: async () => withRoutes(client),
      passkey: () => ({ create: vi.fn(), get: vi.fn() }) as unknown as PasskeyProvider,
    };
    function Where() {
      return <p data-testid="where">{useLocation().pathname}</p>;
    }
    render(
      <CalimeroProvider deps={deps}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <InvitationPrompt>
                    <p>app</p>
                  </InvitationPrompt>
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </CalimeroProvider>,
    );
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByTestId('signup-passkey')); // past the optional name
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/teams/org-1'));
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), '', { invite: 'tok-1' });
    expect(invites.token()).toBeNull();
  });
});
