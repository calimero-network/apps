import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CalimeroClient,
  PasskeyProvider,
} from '@calimero-network/mero-js';
import { SIGN_UP_NOT_FINISHED } from '@calimero-apps/passkey';

import { CalimeroProvider, useCalimero, type CalimeroDeps } from './calimero';
import SignInPanel from './components/SignInPanel';

// Since core #4849 a sign-up takes two prompts. The second is asked right
// after the first; it waits for Approve only when that failed or was refused
// (a blocked prompt, Safari's user-gesture rule, a closed prompt).

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

const notAllowed = (message = 'The request is not allowed by the user agent.') =>
  Object.assign(new Error(message), { name: 'NotAllowedError' });

async function startSignUp() {
  fireEvent.click(await screen.findByTestId('signup-passkey'));
}

/** "Approve with your new passkey", once the sign-up has fallen back to it. */
async function approveButton() {
  const approve = await screen.findByTestId('signup-approve');
  await waitFor(() => expect(approve).not.toBeDisabled());
  expect(approve).toHaveTextContent('Approve with your new passkey');
  return approve;
}

describe("a sign-up's second prompt", () => {
  it('asks both prompts back to back, with no click, then signs in', async () => {
    const { pk } = setup(async () => ({}) as never);
    await startSignUp();
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signed-in'),
    );
    expect(pk.create).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledTimes(1);
  });

  it('a second prompt refused at once waits for Approve, which then signs in', async () => {
    const { pk } = setup(async () => {
      if (pk.get.mock.calls.length === 1) throw notAllowed();
      return {} as never;
    });
    await startSignUp();
    const approve = await approveButton();
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('signin-error')).toBeNull();
    fireEvent.click(approve);
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signed-in'),
    );
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it('a second prompt the person saw and closed shows the error with Approve, which then signs in', async () => {
    const { pk } = setup(async () => {
      if (pk.get.mock.calls.length > 1) return {} as never;
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw notAllowed('The operation either timed out or was not allowed.');
    });
    await startSignUp();
    expect(
      await screen.findByTestId('signin-error', {}, { timeout: 3000 }),
    ).toHaveTextContent(SIGN_UP_NOT_FINISHED);
    fireEvent.click(await approveButton());
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signed-in'),
    );
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it('shows a second prompt refused after Approve and keeps Approve', async () => {
    const { pk } = setup(async () => {
      if (pk.get.mock.calls.length === 1) throw notAllowed();
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw notAllowed('The operation either timed out or was not allowed.');
    });
    await startSignUp();
    fireEvent.click(await approveButton());
    expect(
      await screen.findByTestId('signin-error', {}, { timeout: 3000 }),
    ).toHaveTextContent(SIGN_UP_NOT_FINISHED);
    expect(pk.get).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('signup-approve')).not.toBeDisabled();

    pk.get.mockImplementation(async () => ({}) as never);
    fireEvent.click(screen.getByTestId('signup-approve'));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signed-in'),
    );
  });

  it('Cancel at Approve resets quietly', async () => {
    const { pk } = setup(async () => Promise.reject(notAllowed()));
    await startSignUp();
    await approveButton();
    fireEvent.click(screen.getByTestId('signup-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('signup-approve')).toBeNull(),
    );
    expect(screen.queryByTestId('signin-error')).toBeNull();
    expect(pk.get).toHaveBeenCalledTimes(1);
  });
});
