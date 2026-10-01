import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamespaceJoinDialog } from '../NamespaceJoinDialog';
import { buildInviteUrl } from '@/hooks/useNamespaceInvitation';
import type { SignedGroupOpenInvitation } from '@calimero-network/mero-react';

// The mid-join gate is the dialog's own responsibility; stub the card so
// this file can flip "joining" without driving a real join through mero.
vi.mock('../JoinInviteCard', () => ({
  JoinInviteCard: ({
    onJoiningChange,
  }: {
    onJoiningChange?: (joining: boolean) => void;
  }) => (
    <>
      <button onClick={() => onJoiningChange?.(true)}>start-join</button>
      <button onClick={() => onJoiningChange?.(false)}>end-join</button>
    </>
  ),
}));

const VALID_URL = buildInviteUrl(
  'namespace',
  'ns-abc',
  {} as SignedGroupOpenInvitation,
  'Acme',
);

const noop = () => {};

function openPreview(onClose = vi.fn()) {
  render(<NamespaceJoinDialog onClose={onClose} onJoined={noop} />);
  fireEvent.change(screen.getByPlaceholderText(/mero-docs.vercel.app/i), {
    target: { value: VALID_URL },
  });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  return onClose;
}

describe('NamespaceJoinDialog mid-join gate', () => {
  it('ignores Escape while a join is in flight', async () => {
    const onClose = openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'start-join' }));
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape again once the join finishes', async () => {
    const onClose = openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'start-join' }));
    fireEvent.click(screen.getByRole('button', { name: 'end-join' }));
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
