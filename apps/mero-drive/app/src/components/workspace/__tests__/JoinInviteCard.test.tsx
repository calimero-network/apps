import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinInviteCard } from '../JoinInviteCard';
import type { ParsedInvite } from '@/hooks/useNamespaceInvitation';

// JoinInviteCard reads useMero + useApplicationId directly; stub both to a
// stable authenticated state so the accept button is reachable without a
// real Mero client.
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: vi.fn(),
  useMero: () => ({
    mero: {},
    isAuthenticated: true,
    isLoading: false,
    applicationId: null,
  }),
  useNamespacesForApplication: () => ({
    namespaces: [],
    loading: false,
    error: null,
    refetch: async () => {},
  }),
  ConnectButton: () => <button>Connect</button>,
}));

vi.mock('@/hooks/useApplicationId', () => ({
  useApplicationId: () => ({
    appId: 'app-1',
    resolving: false,
    notInstalled: false,
    inconclusive: false,
  }),
}));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  markNamespaceJustJoined: vi.fn(),
}));

vi.mock('@/hooks/namespaceNames', () => ({
  rememberNamespaceName: vi.fn(),
}));

// Never resolves — stands in for a join request still in flight.
const join = vi.fn(() => new Promise(() => {}));

vi.mock('@/hooks/useNamespaceInvitation', () => ({
  classifyJoinError: () => 'other',
  isInviteExpired: () => false,
  useJoinNamespaceByInvite: () => ({ join }),
  useJoinFolderByInvite: () => ({ join }),
}));

const parsed: ParsedInvite = {
  kind: 'namespace',
  targetId: 'ns-abc',
  invitation: {} as ParsedInvite['invitation'],
  targetName: 'Acme',
};

describe('JoinInviteCard secondary action', () => {
  it('disables the secondary action while a join is in flight, so it cannot unmount the card mid-request', async () => {
    const onSecondary = vi.fn();
    const user = userEvent.setup();
    render(
      <JoinInviteCard
        parsed={parsed}
        onJoined={vi.fn()}
        secondaryAction={{ label: 'Back to invite link', onClick: onSecondary }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /accept & join/i }));
    await screen.findByRole('button', { name: /joining/i });

    const back = screen.getByRole('button', {
      name: /back to invite link/i,
    }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);

    fireEvent.click(back);
    expect(onSecondary).not.toHaveBeenCalled();
  });
});
