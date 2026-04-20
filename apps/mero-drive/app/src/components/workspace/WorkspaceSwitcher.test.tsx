import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const mockListWorkspaces = vi.fn();
const mockIsMemberOfContext = vi.fn();
const mockJoinContextViaGroup = vi.fn();
const mockSetActiveWorkspace = vi.fn();

const workspaceState = {
  activeGroupId: 'stale-group',
};

vi.mock('@calimero-network/calimero-client', () => ({
  useCalimero: () => ({ app: { id: 'test-app' } }),
}));

vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeGroupId: workspaceState.activeGroupId,
    activeContextId: null,
    generalContextId: null,
    setActiveContext: vi.fn(),
    setActiveWorkspace: mockSetActiveWorkspace,
  }),
}));

vi.mock('@/api/WorkspaceManager', () => ({
  WorkspaceManager: class {
    listWorkspaces = mockListWorkspaces;
    isMemberOfContext = mockIsMemberOfContext;
    joinContextViaGroup = mockJoinContextViaGroup;
    resolveGeneralContextId = vi.fn();
    getWorkspaceMembers = vi.fn();
    createWorkspace = vi.fn();
  },
}));

vi.mock('@/api/AdminApi', () => ({
  adminRequest: vi.fn(),
  AdminApiError: class extends Error {},
}));

vi.mock('@/constants/config', () => ({
  getGroupMemberIdentity: vi.fn(() => null),
  setGroupMemberIdentity: vi.fn(),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => null,
}));

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceState.activeGroupId = 'stale-group';
  });

  it('clears stale workspace selection when no workspaces exist', async () => {
    mockListWorkspaces.mockResolvedValue([]);

    render(<WorkspaceSwitcher />);

    await waitFor(() => {
      expect(mockListWorkspaces).toHaveBeenCalledWith('stale-group');
    });

    await waitFor(() => {
      expect(mockSetActiveWorkspace).toHaveBeenCalledWith(null, null);
    });
  });
});
