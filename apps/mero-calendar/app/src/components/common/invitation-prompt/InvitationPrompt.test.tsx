// This app's wiring into @calimero-apps/invite, on a delegated (account)
// session: the codec it supplies, the join it supplies, and what lands on
// screen.
//
// Measured on prod as an account, a join through the raw node route
// (`POST /admin-api/namespaces/{ns}/join`) is a 403. It must go through the
// session-aware `useMero().admin`, which redeems through the admitter — and it
// must not happen before the person has said yes.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NS = 'a1'.repeat(32);
const SIGNED = {
  invitation: { group_id: NS, expiration_timestamp: 0 },
  signature: 'sig',
};

const stub = vi.hoisted(() => {
  const admin = {
    joinNamespace: vi.fn(),
    listNamespacesForApplication: vi.fn(),
    listNamespaces: vi.fn(async () => []),
    listApplications: vi.fn(),
  };
  // The RAW client's admin: the relay's node route, a 403 for an account.
  const rawAdmin = { joinNamespace: vi.fn() };
  return {
    admin,
    rawAdmin,
    navigate: vi.fn(),
    showToast: vi.fn(),
    session: { isAuthenticated: true },
  };
});

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({
    admin: stub.admin,
    mero: { admin: stub.rawAdmin },
    isDelegated: true,
    applicationId: 'app-from-registry',
    isAuthenticated: stub.session.isAuthenticated,
    isLoading: false,
  }),
  setApplicationId: vi.fn(),
  getApplicationId: () => '',
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => stub.navigate }));
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: stub.showToast }),
}));

const { encodeInvitationObject } = await import('../../../utils/invitation');
const { resetInvitationCaptureForTests } = await import(
  '@calimero-apps/invite'
);
const InvitationPrompt = (await import('./InvitationPrompt')).default;

// Exactly what the teams page encodes: the admin's `{ invitation }` envelope
// plus the team name hint.
const TOKEN = encodeInvitationObject({
  invitation: SIGNED,
  __teamName: 'Design',
});

function openWithInvitation(): void {
  resetInvitationCaptureForTests();
  window.history.replaceState(
    null,
    '',
    `/?invitation=${encodeURIComponent(TOKEN)}`,
  );
}

describe('InvitationPrompt – an invite link opened this app', () => {
  beforeEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    stub.session.isAuthenticated = true;
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    resetInvitationCaptureForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('names the team and waits to be asked, joining nothing', async () => {
    openWithInvitation();
    render(<InvitationPrompt />);

    expect(await screen.findByText(/invited to “Design”/)).toBeTruthy();
    expect(screen.getByTestId('invite-accept')).toBeTruthy();
    expect(stub.admin.joinNamespace).not.toHaveBeenCalled();
  });

  it('holds the invitation until the session can join', async () => {
    stub.session.isAuthenticated = false;
    openWithInvitation();
    const { rerender } = render(<InvitationPrompt />);
    expect(screen.queryByTestId('invite-accept')).toBeNull();

    stub.session.isAuthenticated = true;
    rerender(<InvitationPrompt />);
    expect(await screen.findByTestId('invite-accept')).toBeTruthy();
  });

  it('joins on accept through the account admin, never the raw client, and opens the team', async () => {
    stub.admin.listNamespacesForApplication.mockResolvedValue([]);
    stub.admin.joinNamespace.mockImplementation(async () => {
      stub.admin.listNamespacesForApplication.mockResolvedValue([
        {
          namespaceId: NS,
          targetApplicationId: 'app-from-registry',
          name: 'Design',
        },
      ]);
      return { namespaceId: NS };
    });
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId('invite-accept'));

    await waitFor(() =>
      expect(stub.navigate).toHaveBeenCalledWith(`/teams/${NS}`),
    );
    const [namespaceId, body] = stub.admin.joinNamespace.mock.calls[0] as [
      string,
      { invitation: unknown },
    ];
    expect(namespaceId).toBe(NS);
    // The signed invitation goes through untouched: the signature covers it
    // exactly as minted.
    expect(body.invitation).toEqual(SIGNED);
    expect(stub.rawAdmin.joinNamespace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(stub.showToast).toHaveBeenCalledWith(
        'Joined team. Syncing calendar…',
        'success',
      ),
    );
  });

  it('declining joins nothing and puts the prompt away', async () => {
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId('invite-decline'));

    await waitFor(() =>
      expect(screen.queryByTestId('invite-status')).toBeNull(),
    );
    expect(stub.admin.joinNamespace).not.toHaveBeenCalled();
    expect(stub.navigate).not.toHaveBeenCalled();
  });

  it('shows why when the join really failed, and stays put', async () => {
    stub.admin.joinNamespace.mockRejectedValue(
      new Error('could not reach any member of this namespace'),
    );
    stub.admin.listNamespacesForApplication.mockResolvedValue([]);
    openWithInvitation();
    render(<InvitationPrompt />);

    fireEvent.click(await screen.findByTestId('invite-accept'));

    await waitFor(() =>
      expect(
        screen.getByTestId('invite-status').getAttribute('data-stage'),
      ).toBe('failed'),
    );
    expect(stub.navigate).not.toHaveBeenCalled();
  });
});
