import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Whether an opened invitation link is kept or let go ─────────────────────
//
// The platform store replays an unacked invitation on every load. So the prompt
// must ack once the invitation is SETTLED — joined, or refused for good — and
// keep it (with "Try again" up) only when a later try could work. This opens a
// real `?invitation=` link through mero-react's capture and drives the real
// `redeemInvite` against a fake admin, so the decision is the one mero-js makes
// from the node's status.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
}));

const admin = {
  joinNamespace: vi.fn(),
  listNamespaces: vi.fn(),
};
// The RAW client's admin: the node route, a 403 for an account. The prompt
// must redeem through the session-aware `admin` and never reach this one.
const rawAdmin = {
  joinNamespace: vi.fn(),
  listNamespaces: vi.fn(),
};
const SESSION = { mero: { admin: rawAdmin }, admin, isDelegated: true };
vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => SESSION,
}));

const { peekInvitation, resetInvitationCaptureForTests } = await import(
  '@calimero-network/mero-react'
);
const { encodeInvite } = await import('../lib/inviteCodec');
const NS = '010203';
const CODE = encodeInvite({
  invitation: {
    invitation: { group_id: [1, 2, 3], invited_role: 0 },
    inviter_signature: 'ff'.repeat(64),
  },
  groupAlias: 'Acme',
} as never);

import InvitationPrompt from './InvitationPrompt';

const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

/** Open the link as the links page would, and press Join. */
async function openLink() {
  resetInvitationCaptureForTests();
  window.history.replaceState(null, '', `/?invitation=${CODE}`);
  render(<InvitationPrompt />);
  expect(await screen.findByRole('dialog', { name: 'Join “Acme”?' })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('invite-accept'));
}

/** Whether the invitation is still held for another attempt. */
const held = () => peekInvitation() !== null;

beforeEach(() => {
  resetInvitationCaptureForTests();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  navigate.mockReset();
  admin.joinNamespace.mockReset();
  admin.listNamespaces.mockReset();
  admin.listNamespaces.mockResolvedValue([]);
});

describe('InvitationPrompt', () => {
  it('asks first, then acks, lands in the team and waits for its data', async () => {
    admin.joinNamespace.mockResolvedValue({});
    await openLink();
    await waitFor(() =>
      expect(screen.getByTestId('invite-prompt')).toHaveAttribute('data-stage', 'syncing'),
    );
    expect(held()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(`/teams/${NS}`);
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    // On an account (this session is delegated) the join went through the
    // account admin; the raw client's node route was never asked.
    expect(rawAdmin.joinNamespace).not.toHaveBeenCalled();
    expect(rawAdmin.listNamespaces).not.toHaveBeenCalled();
  });

  it('treats a failed request whose namespace is listed as a success', async () => {
    admin.joinNamespace.mockRejectedValue(httpError(0, 'Failed to fetch'));
    admin.listNamespaces.mockResolvedValue([{ namespaceId: NS }]);
    await openLink();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/teams/${NS}`));
    expect(held()).toBe(false);
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
  });

  it('acks a final refusal (409) and says why, with no retry', async () => {
    admin.joinNamespace.mockRejectedValue(httpError(409, 'member was removed'));
    await openLink();
    expect(await screen.findByTestId('invite-error')).toHaveTextContent(
      "You can't join this team with this invitation. Ask an admin to invite you again.",
    );
    expect(held()).toBe(false);
    expect(screen.queryByTestId('invite-retry')).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps a transient failure (503) and offers the retry', async () => {
    admin.joinNamespace.mockRejectedValue(httpError(503, 'no peers'));
    await openLink();
    expect(await screen.findByTestId('invite-error')).toHaveTextContent(
      /No one in this team is online to let you in yet/,
    );
    expect(held()).toBe(true);

    // And the retry really is one: it joins (without asking again), then acks.
    admin.joinNamespace.mockResolvedValue({});
    fireEvent.click(screen.getByTestId('invite-retry'));
    await waitFor(() => expect(held()).toBe(false));
    expect(admin.joinNamespace).toHaveBeenCalledTimes(2);
  });
});
