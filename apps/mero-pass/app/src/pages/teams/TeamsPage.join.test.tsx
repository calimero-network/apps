import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Joining a team from a pasted invitation ─────────────────────────────────
//
// The link path only fires when an invitation is OPENED. One forwarded in a
// chat, read off a phone, or copied with the invite dialog's "Copy code"
// button never opens anything, and until this field there was nowhere to put
// it — the empty state's only instruction was "open an invitation link
// someone sent you".

const redeemInvite = vi.fn();
const navigate = vi.fn();

// Spying on `navigate` rather than watching a MemoryRouter settle: the redeem
// resolves outside React's act() window, so the router's own state update is
// not reliably flushed by the time an assertion runs, and a test that waits
// for it is a test that flakes. WHERE these paths lead is asserted against the
// REAL route table in `App.routes.test.tsx`; what belongs here is that the
// form asks for the right one.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
}));

// ⚠️ STABLE IDENTITIES. `load` is a `useCallback` keyed on the node, the app
// id and `resolving`; a mock that returns a fresh object literal per render
// changes that key every render, so the load effect re-fires forever and any
// "was it fetched again?" assertion counts noise. The same trap the shots
// harness carries a note about.
const SESSION = {
  mero: { admin: {} },
  isAuthenticated: true,
  isLoading: false,
  logout: () => {},
  nodeUrl: 'http://localhost:2428',
};
const IDENTITY = { identity: { accountId: 'a'.repeat(64) } };
const APP_ID = { appId: 'app-1', resolving: false, notInstalled: false };

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => SESSION,
  useNodeIdentity: () => IDENTITY,
}));

vi.mock('../../hooks/useApplicationId', () => ({
  useApplicationId: () => APP_ID,
}));

const listTeams = vi.fn(async () => [] as unknown[]);

vi.mock('../../lib/vaults', () => ({
  listTeams: (...a: unknown[]) => listTeams(...(a as [])),
  listVaults: vi.fn(async () => []),
  createTeam: vi.fn(),
  createPersonalVault: vi.fn(),
  mintTeamInvite: vi.fn(),
  redeemInvite: (...args: unknown[]) => redeemInvite(...args),
}));

// A real invitation, built by the app's own codec so the test exercises the
// actual parse rather than a hand-written string that only looks like one.
const { encodeInvite } = await import('../../lib/inviteCodec');
const { invitationUrl } = await import('../../lib/inviteLink');
const CODE = encodeInvite({
  kind: 'namespace',
  invitation: {
    invitation: { group_id: [1, 2, 3], invited_role: 0 },
    inviter_signature: 'ff'.repeat(64),
  },
  groupAlias: 'Acme',
} as never);

import TeamsPage from './TeamsPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teams']}>
      <TeamsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  redeemInvite.mockReset();
  navigate.mockReset();
  listTeams.mockClear();
  listTeams.mockResolvedValue([]);
});

describe('the join field', () => {
  it('is on the screen, which is the whole point', async () => {
    renderPage();
    expect(await screen.findByTestId('join-code')).toBeInTheDocument();
    expect(screen.getByTestId('join-submit')).toBeInTheDocument();
  });

  it('will not submit an empty field', async () => {
    renderPage();
    expect(await screen.findByTestId('join-submit')).toBeDisabled();
  });

  it('redeems a pasted CODE and lands in the team', async () => {
    redeemInvite.mockResolvedValue({ kind: 'team', namespaceId: 'ns-1' });
    renderPage();
    fireEvent.change(await screen.findByTestId('join-code'), {
      target: { value: CODE },
    });
    fireEvent.click(screen.getByTestId('join-submit'));
    await waitFor(() => expect(redeemInvite).toHaveBeenCalledTimes(1));
    // ⚠️ `/teams/ns-1`, PLURAL. The link prompt used to send this to
    // `/team/<id>`, which has no route and fell through to the catch-all.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/teams/ns-1'));
  });

  it('redeems a pasted LINK too', async () => {
    redeemInvite.mockResolvedValue({ kind: 'team', namespaceId: 'ns-2' });
    renderPage();
    fireEvent.change(await screen.findByTestId('join-code'), {
      target: { value: invitationUrl(CODE) },
    });
    fireEvent.click(screen.getByTestId('join-submit'));
    await waitFor(() => expect(redeemInvite).toHaveBeenCalledTimes(1));
  });

  it('says "not an invitation" for junk, and sends nothing to the node', async () => {
    renderPage();
    fireEvent.change(await screen.findByTestId('join-code'), {
      target: { value: 'hello there' },
    });
    fireEvent.click(screen.getByTestId('join-submit'));
    expect(await screen.findByTestId('join-error')).toHaveTextContent(
      /does not look like a Mero Pass invitation/i,
    );
    // The distinction that matters: a string that is not an invitation is the
    // person's mistake and is fixable; a refused join is not, and reporting
    // one as the other sends them looking in the wrong place.
    expect(redeemInvite).not.toHaveBeenCalled();
  });

  it('surfaces a refused join instead of pretending it worked', async () => {
    redeemInvite.mockRejectedValue(new Error('no reachable member yet'));
    renderPage();
    fireEvent.change(await screen.findByTestId('join-code'), {
      target: { value: CODE },
    });
    fireEvent.click(screen.getByTestId('join-submit'));
    expect(await screen.findByTestId('join-error')).toHaveTextContent(
      /no reachable member yet/i,
    );
    // And it does NOT move you: landing somewhere new after a failed join is
    // how "did that work?" becomes unanswerable.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps what you typed when the join fails, so it can be retried', async () => {
    redeemInvite.mockRejectedValue(new Error('flaky node'));
    renderPage();
    const field = await screen.findByTestId('join-code');
    fireEvent.change(field, { target: { value: CODE } });
    fireEvent.click(screen.getByTestId('join-submit'));
    await screen.findByTestId('join-error');
    expect(field).toHaveValue(CODE);
  });
});

// ── A join that cannot be placed ───────────────────────────────────────────
//
// ⚠️ THE BUG CURSOR BUGBOT CAUGHT, and it was a real one.
//
// `redeemInvite` answers `{kind: 'joined'}` when the team was joined but this
// node cannot yet place it — its vaults have not replicated. That resolves to
// `/teams`, which is where the paste field already is. React Router does not
// remount for a navigation to the current path, and `load`'s dependencies
// (the node, the app id) have not changed — so the list never reloads. The
// field clears, the new team is missing, and a successful join is
// indistinguishable from nothing happening.
describe('a join with nowhere specific to land', () => {
  it('reloads the list instead of pretending the navigation did it', async () => {
    redeemInvite.mockResolvedValue({ kind: 'joined' });
    renderPage();
    await waitFor(() => expect(listTeams).toHaveBeenCalledTimes(1));

    fireEvent.change(await screen.findByTestId('join-code'), {
      target: { value: CODE },
    });
    fireEvent.click(screen.getByTestId('join-submit'));

    // The list is fetched AGAIN. Without the fix this stays at 1 forever.
    await waitFor(() => expect(listTeams).toHaveBeenCalledTimes(2));
  });

  it('does not re-fetch when it really did go somewhere else', async () => {
    // The refresh is for the same-page case only; a real navigation unmounts
    // this screen and reloading it would be a wasted round trip.
    redeemInvite.mockResolvedValue({ kind: 'team', namespaceId: 'ns-9' });
    renderPage();
    await waitFor(() => expect(listTeams).toHaveBeenCalledTimes(1));

    fireEvent.change(await screen.findByTestId('join-code'), {
      target: { value: CODE },
    });
    fireEvent.click(screen.getByTestId('join-submit'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/teams/ns-9'));
    expect(listTeams).toHaveBeenCalledTimes(1);
  });
});
