import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinInviteCard } from '../JoinInviteCard';
import type { ParsedInvite } from '@/hooks/useNamespaceInvitation';

// JoinInviteCard reads useMero + useApplicationId directly; stub both so the
// accept button is reachable without a real Mero client.
// Answers like core: one id-ordered page per request, 100 rows unless asked.
const listNamespacesForApplication = vi.hoisted(() =>
  vi.fn(async (appIdAndQuery: string) => {
    const query = new URLSearchParams(appIdAndQuery.split('?')[1] ?? '');
    const offset = Number(query.get('offset') ?? 0);
    const limit = Number(query.get('limit') ?? 100);
    const ids = Array.from({ length: 101 }, (_, i) => `ns-${String(i).padStart(3, '0')}`);
    return ids.slice(offset, offset + limit).map((namespaceId) => ({ namespaceId }));
  }),
);

vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: vi.fn(),
  useMero: () => ({
    mero: { admin: { listNamespacesForApplication } },
    isAuthenticated: true,
    isLoading: false,
    applicationId: null,
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

// Never resolves - stands in for a join request still in flight.
const join = vi.fn(() => new Promise(() => {}));

vi.mock('@/hooks/useNamespaceInvitation', () => ({
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

describe('JoinInviteCard membership', () => {
  it('knows a member of a workspace past the node’s first page of 100', async () => {
    render(
      <JoinInviteCard parsed={{ ...parsed, targetId: 'ns-100' }} onJoined={vi.fn()} />,
    );
    expect(
      await screen.findByText(/already a member of this workspace/),
    ).toBeTruthy();
  });
});

describe('JoinInviteCard target', () => {
  it.each([
    ['namespace', 'a workspace'],
    ['group', 'a folder'],
  ] as const)('names an unnamed %s plainly instead of showing its id', (kind, phrase) => {
    render(
      <JoinInviteCard
        parsed={{ ...parsed, kind, targetId: 'ns-abcdef0123456789', targetName: undefined }}
        onJoined={vi.fn()}
      />,
    );
    const intro = screen.getByText(/invited to join/);
    expect(intro.textContent).toContain(`invited to join ${phrase}.`);
    expect(intro.textContent).not.toContain('ns-abcdef');
  });
});
