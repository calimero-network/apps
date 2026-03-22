import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyProfileDialog } from './MyProfileDialog';

const mocks = vi.hoisted(() => ({
  mockUseCalimero: vi.fn(),
  mockUseWorkspace: vi.fn(),
  mockUseGroupPermissions: vi.fn(),
  mockSetMemberAlias: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@calimero-network/calimero-client', () => ({
  useCalimero: (...args: any[]) => mocks.mockUseCalimero(...args),
}));

vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: (...args: any[]) => mocks.mockUseWorkspace(...args),
}));

vi.mock('@/hooks/useGroupPermissions', () => ({
  useGroupPermissions: (...args: any[]) => mocks.mockUseGroupPermissions(...args),
}));

vi.mock('@/api/WorkspaceManager', () => ({
  WorkspaceManager: class {
    setMemberAlias = mocks.mockSetMemberAlias;
  },
}));

describe('MyProfileDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseCalimero.mockReturnValue({ app: {}, isAuthenticated: true });
    mocks.mockUseWorkspace.mockReturnValue({
      activeGroupId: 'g1',
      activeContextId: 'ctx-1',
      generalContextId: 'general-1',
      setActiveContext: vi.fn(),
      setActiveWorkspace: vi.fn(),
    });
    mocks.mockUseGroupPermissions.mockReturnValue({
      currentMemberIdentity: 'user-abc-123',
      isAdmin: false,
      members: [
        { identity: 'user-abc-123', role: 'Member', alias: 'Alice' },
      ],
      refresh: mocks.mockRefresh.mockResolvedValue(undefined),
    });
    mocks.mockSetMemberAlias.mockResolvedValue(undefined);
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <MyProfileDialog isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the member identity when open', () => {
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('user-abc-123')).toBeTruthy();
  });

  it('shows the role badge', () => {
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Member')).toBeTruthy();
  });

  it('shows Admin role when the member is an admin', () => {
    mocks.mockUseGroupPermissions.mockReturnValue({
      currentMemberIdentity: 'user-abc-123',
      isAdmin: true,
      members: [
        { identity: 'user-abc-123', role: 'Admin', alias: 'Alice' },
      ],
      refresh: mocks.mockRefresh,
    });
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('pre-fills the alias input with the current alias', () => {
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter a display name...');
    expect((input as HTMLInputElement).value).toBe('Alice');
  });

  it('disables Save button when alias has not changed', () => {
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    const saveBtn = screen.getByText('Save');
    expect((saveBtn.closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Save button when alias has changed', async () => {
    const user = userEvent.setup();
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter a display name...');
    await user.clear(input);
    await user.type(input, 'Bob');
    const saveBtn = screen.getByText('Save');
    expect((saveBtn.closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls setMemberAlias with the correct arguments on save', async () => {
    const user = userEvent.setup();
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter a display name...');
    await user.clear(input);
    await user.type(input, 'Bob');
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mocks.mockSetMemberAlias).toHaveBeenCalledWith(
        'g1',
        'user-abc-123',
        'Bob',
      );
    });
  });

  it('calls refresh after a successful save', async () => {
    const user = userEvent.setup();
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter a display name...');
    await user.clear(input);
    await user.type(input, 'Charlie');
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mocks.mockRefresh).toHaveBeenCalled();
    });
  });

  it('shows an error message when save fails', async () => {
    mocks.mockSetMemberAlias.mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();
    render(<MyProfileDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter a display name...');
    await user.clear(input);
    await user.type(input, 'FailName');
    await user.click(screen.getByText('Save'));

    expect(await screen.findByText('Failed to update alias.')).toBeTruthy();
  });
});
