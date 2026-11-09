import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CalimeroClient,
  PasskeyProvider,
} from '@calimero-network/mero-js';
import { SIGN_UP_NOT_FINISHED } from '@calimero-apps/passkey';

import { CalimeroProvider, useCalimero, type CalimeroDeps } from './calimero';
import SignInPanel from './components/SignInPanel';

// Since core #4849 a sign-up takes two prompts; a password manager extension
// still saving the new passkey refused the second when it was asked for at
// once, which left a passkey and no account.

function setup(get: PasskeyProvider['get']) {
  const pk = { create: vi.fn(async () => ({}) as never), get: vi.fn(get) };
  const client = {
    session: undefined as undefined | { accountId: string },
    useSession: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(async () => {}),
    signUp: vi.fn(async (p: PasskeyProvider) => {
      await p.create({} as never);
      await p.get(new Uint8Array([1]), 'example.com', ['new-cred']);
      client.session = { accountId: 'acct-new' };
      return client.session;
    }),
  };
  const deps: CalimeroDeps = {
    env: { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' },
    makeClient: async () => client as unknown as CalimeroClient,
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

beforeEach(() => {
  localStorage.clear();
});

describe("a sign-up's second prompt", () => {
  it('waits for Approve before asking, then signs in', async () => {
    const { pk } = setup(async () => ({}) as never);
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByTestId('signup-passkey')); // past the optional name
    const approve = await screen.findByTestId('signup-approve');
    expect(approve).toHaveTextContent('Approve with your new passkey');
    expect(pk.get).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signed-in'),
    );
    expect(pk.get).toHaveBeenCalledTimes(1);
  });

  it('shows a refused second prompt and keeps Approve', async () => {
    const refused = Object.assign(
      new Error('The operation either timed out or was not allowed.'),
      { name: 'NotAllowedError' },
    );
    const { pk } = setup(async () => {
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw refused;
    });
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByTestId('signup-approve'));
    expect(
      await screen.findByTestId('signin-error', {}, { timeout: 3000 }),
    ).toHaveTextContent(SIGN_UP_NOT_FINISHED);
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('signup-approve')).not.toBeDisabled();

    pk.get.mockImplementation(async () => ({}) as never);
    fireEvent.click(screen.getByTestId('signup-approve'));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signed-in'),
    );
  });

  it('Cancel at Approve resets quietly', async () => {
    const { pk } = setup(async () => ({}) as never);
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByTestId('signup-passkey'));
    fireEvent.click(await screen.findByTestId('signup-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('signup-approve')).toBeNull(),
    );
    expect(screen.queryByTestId('signin-error')).toBeNull();
    expect(pk.get).not.toHaveBeenCalled();
  });
});
