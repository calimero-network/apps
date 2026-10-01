import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JoinInviteCard } from '../JoinInviteCard';
import type { ParsedInvite } from '@/hooks/useNamespaceInvitation';
import { markNamespaceJustJoined } from '@/hooks/useDriveWorkspace';

// The card's one decision worth pinning: what a join's outcome does. A join,
// or a failed request for a workspace the node now lists, lands the user; a
// failure no retry can fix retires the button; one that could pass offers it
// again.

const h = vi.hoisted(() => ({
  admin: {} as Record<string, (...a: unknown[]) => Promise<unknown>>,
}));

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({
    mero: { admin: h.admin },
    isAuthenticated: true,
    isLoading: false,
  }),
  ConnectButton: () => <button>Connect</button>,
}));

vi.mock('@/hooks/useApplicationId', () => ({
  useApplicationId: () => ({ appId: 'app-1' }),
}));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  markNamespaceJustJoined: vi.fn(),
}));

vi.mock('@/hooks/namespaceNames', () => ({
  rememberNamespaceName: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(markNamespaceJustJoined).mockClear();
});

const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

const parsed: ParsedInvite = {
  kind: 'namespace',
  targetId: 'ns1',
  invitation: {} as ParsedInvite['invitation'],
  targetName: 'Acme',
};

function setup(admin: {
  joinNamespace: () => Promise<unknown>;
  listNamespaces?: () => Promise<unknown>;
}) {
  h.admin = {
    listNamespaces: () => Promise.resolve([]),
    listNamespacesForApplication: () => Promise.resolve([]),
    ...admin,
  };
  const onJoined = vi.fn();
  render(<JoinInviteCard parsed={parsed} onJoined={onJoined} />);
  fireEvent.click(screen.getByRole('button', { name: /accept & join/i }));
  return onJoined;
}

describe('JoinInviteCard redeem', () => {
  it('lands the user on a join', async () => {
    const onJoined = setup({ joinNamespace: () => Promise.resolve({}) });
    await vi.waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(markNamespaceJustJoined).toHaveBeenCalledWith('ns1');
  });

  it('lands the user when the join failed but the node lists the workspace', async () => {
    const joinNamespace = vi.fn(() =>
      Promise.reject(new Error('The request was aborted')),
    );
    const onJoined = setup({
      joinNamespace,
      listNamespaces: () => Promise.resolve([{ namespaceId: 'ns1' }]),
    });
    await vi.waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(markNamespaceJustJoined).toHaveBeenCalledWith('ns1');
    expect(joinNamespace).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says why a refused invitation failed, and retires the button', async () => {
    const onJoined = setup({
      joinNamespace: () => Promise.reject(httpError(409, 'member was removed')),
    });
    await screen.findByText(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
    const button = screen.getByRole('button', {
      name: /accept & join/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it('offers another attempt when no one is online to let you in', async () => {
    const onJoined = setup({
      joinNamespace: () => Promise.reject(httpError(503, 'no peer available')),
    });
    await screen.findByText(/No one in this workspace is online/);
    const retry = (await screen.findByRole('button', {
      name: /try again/i,
    })) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it('shows the expired card when the node says the invitation expired', async () => {
    setup({
      joinNamespace: () =>
        Promise.reject(httpError(410, 'invitation has expired')),
    });
    await screen.findByText(/This invitation has expired/);
    expect(screen.queryByRole('button', { name: /accept & join/i })).toBeNull();
  });
});
