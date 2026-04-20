// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MembersIndicator } from './MembersIndicator';

const mocks = vi.hoisted(() => ({
  passThrough: (props: any) => props.children ?? null,
  mockUseWorkspace: vi.fn(),
  mockUseGroupPermissions: vi.fn(),
  mockRefresh: vi.fn().mockResolvedValue(undefined),
  memberDetailPanel: (props: any) =>
    props.isOpen ? `DETAIL_OPEN:${props.member?.identity ?? '?'}` : null,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: (...args: any[]) => mocks.mockUseWorkspace(...args),
}));

vi.mock('@/hooks/useGroupPermissions', () => ({
  useGroupPermissions: (...args: any[]) => mocks.mockUseGroupPermissions(...args),
}));

vi.mock('./MemberDetailPanel', () => ({
  MemberDetailPanel: mocks.memberDetailPanel,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: mocks.passThrough,
  DropdownMenuTrigger: mocks.passThrough,
  DropdownMenuContent: mocks.passThrough,
  DropdownMenuItem: mocks.passThrough,
  DropdownMenuSeparator: () => null,
}));

const MEMBERS = [
  { identity: 'abcdef123456789', role: 'Admin' as const, alias: 'Alice' },
  { identity: 'xyz987654321000', role: 'Member' as const, alias: undefined },
];

describe('MembersIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseWorkspace.mockReturnValue({
      activeGroupId: 'g1',
      activeContextId: 'ctx-1',
      generalContextId: 'general-1',
      setActiveContext: vi.fn(),
      setActiveWorkspace: vi.fn(),
    });
    mocks.mockUseGroupPermissions.mockReturnValue({
      members: MEMBERS,
      currentMemberIdentity: 'abcdef123456789',
      isAdmin: true,
      isLoading: false,
      refresh: mocks.mockRefresh,
    });
  });

  it('returns null when activeGroupId is missing', () => {
    mocks.mockUseWorkspace.mockReturnValue({
      activeGroupId: null,
      activeContextId: null,
      generalContextId: null,
      setActiveContext: vi.fn(),
      setActiveWorkspace: vi.fn(),
    });
    const { container } = render(<MembersIndicator contextId="ctx-1" />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when members list is empty', () => {
    mocks.mockUseGroupPermissions.mockReturnValue({
      members: [],
      currentMemberIdentity: null,
      isAdmin: false,
      isLoading: false,
      refresh: mocks.mockRefresh,
    });
    const { container } = render(<MembersIndicator contextId="ctx-1" />);
    expect(container.innerHTML).toBe('');
  });

  it('displays the member count', () => {
    render(<MembersIndicator contextId="ctx-1" />);
    expect(screen.getByText('2 members')).toBeTruthy();
  });

  it('renders member display names', () => {
    render(<MembersIndicator contextId="ctx-1" />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('xyz987...1000')).toBeTruthy();
  });

  it('shows "(you)" badge for the current member', () => {
    render(<MembersIndicator contextId="ctx-1" />);
    expect(screen.getByText('(you)')).toBeTruthy();
  });

  it('shows Admin badge for admin-role members', () => {
    render(<MembersIndicator contextId="ctx-1" />);
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('shows Member label for non-admin members', () => {
    render(<MembersIndicator contextId="ctx-1" />);
    expect(screen.getByText('Member')).toBeTruthy();
  });

  it('opens MemberDetailPanel when a member row is clicked', async () => {
    const user = userEvent.setup();
    render(<MembersIndicator contextId="ctx-1" />);
    await user.click(screen.getByText('Alice'));
    expect(screen.getByText('DETAIL_OPEN:abcdef123456789')).toBeTruthy();
  });
});
