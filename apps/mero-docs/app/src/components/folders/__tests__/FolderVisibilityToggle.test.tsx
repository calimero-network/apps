import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HTTPError } from '@calimero-network/mero-js';
import { FolderVisibilityToggle } from '../FolderVisibilityToggle';

const BOB = 'b'.repeat(64);
const setSubgroupVisibility = vi.fn();
const listGroupMembers = vi.fn();
const addGroupMembers = vi.fn();
const updateMemberRole = vi.fn();
const setMemberCapabilities = vi.fn();
const setFolderRole = vi.fn();
const BASE = [
  { id: 'parent', parent_id: null, visibility: 'Open' },
  { id: 'child', parent_id: 'parent', visibility: 'Restricted' },
];
const workspace: { folders: { id: string; parent_id: string | null; visibility?: string }[] } = {
  folders: BASE,
};

vi.mock('@calimero-network/mero-react', () => ({
  useSetSubgroupVisibility: () => ({ setSubgroupVisibility }),
  useMero: () => ({
    mero: {
      admin: {
        listGroupMembers,
        addGroupMembers,
        updateMemberRole,
        setMemberCapabilities,
        getMemberCapabilities: async () => ({ capabilities: 0 }),
      },
    },
  }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    refetch: vi.fn().mockResolvedValue(undefined),
    registryClient: { setFolderRole, getFolderRole: async () => 'Editor' },
    folders: workspace.folders,
  }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({ canManageVisibility: true }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));

beforeEach(() => {
  workspace.folders = BASE;
  for (const fn of [setSubgroupVisibility, addGroupMembers, setMemberCapabilities, setFolderRole]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  updateMemberRole.mockReset().mockRejectedValue(new HTTPError(404, '', '/groups/child', new Headers()));
  listGroupMembers.mockReset().mockImplementation(async () => ({
    // Opened, the child lists Bob with his parent row's role.
    members: [{ identity: BOB, role: 'ReadOnly' }],
  }));
});

describe('FolderVisibilityToggle', () => {
  // Opening lets the parent's members in by inheritance, Read only ones included.
  it("makes the parent's Read only members Read only in a folder it opens", async () => {
    render(<FolderVisibilityToggle folderId="child" current="Restricted" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make open' }));
    await waitFor(() =>
      expect(addGroupMembers).toHaveBeenCalledWith('child', {
        members: [{ identity: BOB, role: 'ReadOnly' }],
      }),
    );
    expect(setSubgroupVisibility).toHaveBeenCalledWith('child', { subgroupVisibility: 'open' });
  });

  // Opening a folder also opens the way to its Open sub-folders, which then need the row too.
  it("carries Read only into the Open sub-folders below a folder it opens", async () => {
    workspace.folders = [...BASE, { id: 'grandchild', parent_id: 'child', visibility: 'Open' }];
    render(<FolderVisibilityToggle folderId="child" current="Restricted" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make open' }));
    await waitFor(() =>
      expect(addGroupMembers).toHaveBeenCalledWith('grandchild', {
        members: [{ identity: BOB, role: 'ReadOnly' }],
      }),
    );
  });

  it('reports a sub-folder whose visibility it does not know', async () => {
    const onError = vi.fn();
    workspace.folders = [...BASE, { id: 'unread', parent_id: 'child' }];
    render(<FolderVisibilityToggle folderId="child" current="Restricted" onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make open' }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('carries nothing when it restricts a folder', async () => {
    render(<FolderVisibilityToggle folderId="child" current="Open" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make restricted' }));
    await waitFor(() => expect(setSubgroupVisibility).toHaveBeenCalled());
    expect(listGroupMembers).not.toHaveBeenCalled();
  });
});
