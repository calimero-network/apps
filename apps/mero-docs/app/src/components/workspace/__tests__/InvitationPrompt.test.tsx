import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvitationPrompt } from '../InvitationPrompt';
import { migrateLegacyInvite } from '@/hooks/useNamespaceInvitation';
import { withRoutes } from '@calimero-apps/connect/testing';

// Joining is where a workspace asks your name: once, only when the org has
// none for you, and saved to the org before the workspace opens.
const admin = withRoutes({
  self: 'me',
  isOrgMember: vi.fn(),
  redeemInvite: vi.fn(),
  getMemberMetadata: vi.fn(),
  getOrg: vi.fn(),
  setMemberMetadata: vi.fn(),
});
vi.mock('@/calimero/react', () => ({
  useMero: () => ({ admin, isAuthenticated: true }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({ MAX_DISPLAY_NAME_LEN: 64 }));
vi.mock('@/hooks/useDriveWorkspace', () => ({ useDriveWorkspace: () => ({}) }));

const invite = {
  token: 'tok',
  kind: 'namespace',
  targetId: 'org-1',
  workspaceId: 'org-1',
  targetName: 'Acme',
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('mero-docs:pending-invite', JSON.stringify(invite));
  migrateLegacyInvite();
  for (const fn of Object.values(admin)) if (typeof fn === 'function') fn.mockReset();
  admin.isOrgMember.mockResolvedValue(false);
  admin.redeemInvite.mockResolvedValue('org-1');
  admin.getOrg.mockResolvedValue({ memberMetadata: {} });
  admin.setMemberMetadata.mockResolvedValue(undefined);
});

describe('InvitationPrompt asks your name once, right after joining', () => {
  it('asks when the workspace has no name for you, saves it to the org, then opens it', async () => {
    admin.getMemberMetadata.mockResolvedValue(null);
    localStorage.setItem('calimero-names:last', 'Ada');
    const onJoined = vi.fn();
    render(<InvitationPrompt onJoined={onJoined} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('invite-accept'));

    await screen.findByTestId('invite-name');
    expect(onJoined).not.toHaveBeenCalled();
    const field = screen.getByPlaceholderText('Your display name') as HTMLInputElement;
    expect(field.value).toBe('Ada');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('org-1', null));
    expect(admin.setMemberMetadata).toHaveBeenCalledWith('org-1', 'me', { name: 'Ada' });
  });

  it('does not ask when the workspace already has your name', async () => {
    admin.getMemberMetadata.mockResolvedValue({ name: 'Ada' });
    const onJoined = vi.fn();
    render(<InvitationPrompt onJoined={onJoined} />);
    await userEvent.setup().click(await screen.findByTestId('invite-accept'));

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('org-1', null));
    expect(screen.queryByTestId('invite-name')).toBeNull();
    expect(admin.setMemberMetadata).not.toHaveBeenCalled();
  });
});
