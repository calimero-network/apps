import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvitationPrompt } from '../InvitationPrompt';
import { invites, migrateLegacyInvite } from '@/hooks/useNamespaceInvitation';
import { CalimeroError } from '@calimero-network/mero-js';
import { withRoutes } from '@calimero-apps/connect/testing';

// Joining is where a workspace asks your name: once, only when the org has
// none for you, and saved to the org before the workspace opens.
const admin = withRoutes({
  self: 'me',
  joined: vi.fn(),
  getMemberMetadata: vi.fn(),
  getOrg: vi.fn(),
  setMemberMetadata: vi.fn(),
});
const client = {};
vi.mock('@/calimero/react', () => ({
  useMero: () => ({ admin, client, isAuthenticated: true }),
}));
vi.mock('@/calimero/session', () => ({ useSession: () => ({ passkey: () => ({}) }) }));
// The shared dialog is mero-react's to test: here only what the prompt hands it and does after.
const accept = vi.hoisted(() => ({ props: undefined as undefined | Record<string, any> }));
vi.mock('@calimero-network/mero-react', () => ({
  AcceptInviteDialog: (p: Record<string, any>) => {
    accept.props = p;
    return (
      <div role="dialog" aria-label="accept dialog">
        <button onClick={() => p.onJoined({ org: 'org-1' })}>join</button>
        <button onClick={p.onClose}>close</button>
        <button onClick={() => p.onError(new CalimeroError(400, 'REJECTED', 'this invite has expired'))}>spent</button>
        <button onClick={() => p.onError(new CalimeroError(401, 'UNAUTHORIZED', 'session expired'))}>lapsed</button>
      </div>
    );
  },
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
    await user.click(await screen.findByRole('button', { name: 'join' }));

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
    await userEvent.setup().click(await screen.findByRole('button', { name: 'join' }));

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('org-1', null));
    expect(screen.queryByTestId('invite-name')).toBeNull();
    expect(admin.setMemberMetadata).not.toHaveBeenCalled();
  });
});

describe('InvitationPrompt hands the invite to the shared accept dialog', () => {
  it('passes the stored token and the app, and drops the invite once joined', async () => {
    admin.getMemberMetadata.mockResolvedValue({ name: 'Ada' });
    const onJoined = vi.fn();
    render(<InvitationPrompt onJoined={onJoined} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'join' }));

    expect(accept.props).toMatchObject({ token: 'tok', appName: 'Mero Docs', client, open: true });
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('org-1', null));
    expect(admin.joined).toHaveBeenCalledWith('org-1');
    expect(invites.token()).toBeNull();
  });

  it('opens the folder a folder invite names', async () => {
    localStorage.setItem(
      'mero-docs:pending-invite',
      JSON.stringify({ ...invite, kind: 'group', targetId: 'eng' }),
    );
    migrateLegacyInvite();
    admin.getMemberMetadata.mockResolvedValue({ name: 'Ada' });
    const onJoined = vi.fn();
    render(<InvitationPrompt onJoined={onJoined} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'join' }));

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('org-1', 'eng'));
  });

  it('closing the dialog declines: the invite is dropped and the dialog goes', async () => {
    render(<InvitationPrompt onJoined={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'close' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invites.token()).toBeNull();
  });

  it('names the workspace of a workspace invite so the dialog can tell a member, and says "workspace"', async () => {
    render(<InvitationPrompt onJoined={vi.fn()} />);
    await screen.findByRole('button', { name: 'join' });

    expect(accept.props).toMatchObject({ org: 'org-1', labels: { noun: 'workspace', title: "You're invited" } });
    expect(accept.props!.labels.body).toContain('added to the workspace');
  });

  it('names no org for a folder invite and restores the folder wording', async () => {
    localStorage.setItem('mero-docs:pending-invite', JSON.stringify({ ...invite, kind: 'group', targetId: 'eng' }));
    migrateLegacyInvite();
    render(<InvitationPrompt onJoined={vi.fn()} />);
    await screen.findByRole('button', { name: 'join' });

    expect(accept.props!.org).toBeUndefined();
    expect(accept.props!.labels.noun).toBe('folder');
    expect(accept.props!.labels.body).toContain("only gain access to this folder");
  });

  it('a member who continues runs the join follow-up and the invite is dropped', async () => {
    admin.getMemberMetadata.mockResolvedValue({ name: 'Ada' });
    const onJoined = vi.fn();
    render(<InvitationPrompt onJoined={onJoined} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'join' }));

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('org-1', null));
    expect(invites.token()).toBeNull();
  });

  it('drops the invite when the node says it is spent', async () => {
    render(<InvitationPrompt onJoined={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'spent' }));

    expect(invites.token()).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps the invite when the failure is a lapsed session', async () => {
    render(<InvitationPrompt onJoined={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'lapsed' }));

    expect(invites.token()).toBe('tok');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
