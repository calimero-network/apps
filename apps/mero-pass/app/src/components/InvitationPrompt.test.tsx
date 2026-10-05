import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Whether an opened invitation link is kept or let go ─────────────────────
//
// The platform store replays an unacked invitation on every load. So the prompt
// must ack once the invitation is SETTLED — joined, or refused for good — and
// keep it (with the Join button still up) only when a later try could work.
// This drives the real `redeemInvite` against a fake admin, so the decision is
// the one `@calimero-apps/invite` makes from the node's status.

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
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => SESSION,
}));

type Listener = (captured: {
  token: string;
  resolve: () => void;
  autoJoin: boolean;
}) => void;
let listener: Listener | null = null;
vi.mock('@calimero-apps/invite', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  onInvitation: (l: Listener) => {
    listener = l;
    return () => {
      listener = null;
    };
  },
}));

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

async function openLink() {
  const resolve = vi.fn();
  render(<InvitationPrompt />);
  await waitFor(() => expect(listener).not.toBeNull());
  act(() => listener?.({ token: CODE, resolve, autoJoin: false }));
  fireEvent.click(await screen.findByTestId('invite-accept'));
  return resolve;
}

beforeEach(() => {
  navigate.mockReset();
  admin.joinNamespace.mockReset();
  admin.listNamespaces.mockReset();
  admin.listNamespaces.mockResolvedValue([]);
});

describe('InvitationPrompt', () => {
  it('acks and lands in the team once joined', async () => {
    admin.joinNamespace.mockResolvedValue({});
    const resolve = await openLink();
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
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
    const resolve = await openLink();
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith(`/teams/${NS}`);
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
  });

  it('acks a final refusal (409) and says why, with no retry', async () => {
    admin.joinNamespace.mockRejectedValue(httpError(409, 'member was removed'));
    const resolve = await openLink();
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        "You can't join this team with this invitation. Ask an admin to invite you again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('invite-accept')).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps a transient failure (503) and offers the retry', async () => {
    admin.joinNamespace.mockRejectedValue(httpError(503, 'no peers'));
    const resolve = await openLink();
    expect(
      await screen.findByText(
        /No one in this team is online to let you in yet/,
      ),
    ).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
    const retry = screen.getByTestId('invite-accept');
    await waitFor(() => expect(retry).not.toBeDisabled());

    // And the retry really is one: a second click joins and then acks.
    admin.joinNamespace.mockResolvedValue({});
    fireEvent.click(retry);
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(admin.joinNamespace).toHaveBeenCalledTimes(2);
  });
});
