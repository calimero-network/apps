// One role control per member row, and the confirmations in front of role
// changes, leaving and restricting a folder: cancel writes nothing, confirm
// writes once.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NamespaceMemberRow } from '@/components/admin/NamespaceMemberRow';
import { FolderMemberRoleRow } from '@/components/admin/FolderMemberRoleRow';
import { FolderSharingPanel } from '@/components/folders/FolderSharingPanel';
import { FolderVisibilityToggle } from '@/components/folders/FolderVisibilityToggle';
import { DEFAULT_NEW_MEMBER_CAPS } from '@/constants/config';
import { MANAGER_FOLDER_CAPS, WORKSPACE_ROLE_GRANTS } from '@/lib/roles';

const confirm = vi.fn();
const setMemberCapabilities = vi.fn();
const updateMemberRole = vi.fn();
const setSubgroupVisibility = vi.fn();
const setFolderRole = vi.fn();
const setCapabilities = vi.fn();
const removeMember = vi.fn();
const caps = { value: DEFAULT_NEW_MEMBER_CAPS as number | null };
const ME = { identity: 'me', name: 'Me', role: 'Member' };
const folderMembers = { value: [ME] };
const folderPerms = { canManagePermissions: false };

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => confirm,
}));
vi.mock('@calimero-network/mero-react', () => ({
  useGroupCapabilities: () => ({
    capabilities: caps.value,
    loading: false,
    error: null,
    refetch: vi.fn(),
    setCapabilities,
  }),
  useMero: () => ({ mero: { admin: { setMemberCapabilities } } }),
  useUpdateMemberRole: () => ({ updateMemberRole }),
  useSetSubgroupVisibility: () => ({ setSubgroupVisibility }),
  useGroupMembers: () => ({ members: [], loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    selfIdentity: 'me',
    registryContextId: 'ctx',
    registryClient: { setFolderRole },
    registryAdmin: { isOwner: true, addManager: vi.fn(), removeManager: vi.fn() },
    namespaceMemberNames: { bob: 'Bob' },
    folders: [{ id: 'f1', alias: 'Plans', visibility: 'Restricted' }],
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useContextEvents', () => ({ useContextEvents: vi.fn() }));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: () => ({ name: null, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useAdminRenameMember', () => ({
  useAdminRenameMember: () => ({ canRename: false, renameTo: vi.fn() }),
  MAX_DISPLAY_NAME_LEN: 64,
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({
    canManageVisibility: true,
    canManagePermissions: folderPerms.canManagePermissions,
    canManageMembers: true,
    canInviteMembers: false,
  }),
}));
vi.mock('@/hooks/useFolderMembership', () => ({
  useFolderMembership: () => ({
    members: folderMembers.value,
    loading: false,
    error: null,
    add: vi.fn(),
    remove: removeMember,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useFolderRole', () => ({
  useFolderRoles: () => ({ entries: [], refetch: vi.fn() }),
}));
vi.mock('@/hooks/useNamespaceInvitation', () => ({
  useCreateFolderInvite: () => ({ create: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  caps.value = DEFAULT_NEW_MEMBER_CAPS;
  folderMembers.value = [ME];
  folderPerms.canManagePermissions = false;
  for (const fn of [
    setMemberCapabilities,
    updateMemberRole,
    setSubgroupVisibility,
    setFolderRole,
    setCapabilities,
    removeMember,
  ]) {
    fn.mockResolvedValue(undefined);
  }
});

function renderWorkspaceRow(overrides: Partial<React.ComponentProps<typeof NamespaceMemberRow>> = {}) {
  const onRemove = vi.fn().mockResolvedValue(undefined);
  render(
    <ul>
      <NamespaceMemberRow
        groupId="ns"
        identity="alice"
        label="Alice"
        role="Member"
        actorRole="Admin"
        actorCaps={null}
        adminCount={1}
        canManage
        onRemove={onRemove}
        {...overrides}
      />
    </ul>,
  );
  return { onRemove };
}

describe('workspace member row', () => {
  it('has one role control, showing the mapped role', () => {
    renderWorkspaceRow();
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(1);
    expect((selects[0] as HTMLSelectElement).value).toBe('Editor');
  });

  it('offers Guest, not the folder-only Read only', () => {
    renderWorkspaceRow();
    expect(screen.getByRole('option', { name: 'Guest' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Read only' })).toBeNull();
  });

  it('shows Custom for a mask no role describes', () => {
    caps.value = 4;
    renderWorkspaceRow();
    expect(screen.getByRole('option', { name: 'Custom' })).toBeTruthy();
  });

  it('writes nothing when the role change is cancelled', async () => {
    confirm.mockResolvedValue(false);
    renderWorkspaceRow();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Manager' } });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0].title).toBe("Change Alice's role to Manager?");
    expect(confirm.mock.calls[0][0].destructive).toBe(true);
    expect(setMemberCapabilities).not.toHaveBeenCalled();
    expect(updateMemberRole).not.toHaveBeenCalled();
  });

  it('applies the mapped writes once when confirmed', async () => {
    confirm.mockResolvedValue(true);
    renderWorkspaceRow();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Manager' } });
    await waitFor(() => expect(setMemberCapabilities).toHaveBeenCalledTimes(1));
    expect(setMemberCapabilities.mock.calls[0][2]).toEqual({
      capabilities: WORKSPACE_ROLE_GRANTS.Manager.caps,
    });
    expect(updateMemberRole).not.toHaveBeenCalled();
  });

  it('asks before you leave the workspace, and cancel keeps you in', async () => {
    confirm.mockResolvedValue(false);
    const { onRemove } = renderWorkspaceRow({ isSelf: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const opts = confirm.mock.calls[0][0];
    expect(opts.title).toBe('Leave this workspace?');
    expect(opts.destructive).toBe(true);
    render(<>{opts.body}</>);
    expect(screen.getByText(/need a new invite/)).toBeTruthy();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('removes you once when you confirm leaving', async () => {
    confirm.mockResolvedValue(true);
    const { onRemove } = renderWorkspaceRow({ isSelf: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
  });

  // The node refuses both: the owner is immune from removal, and a group keeps one admin.
  it('offers the owner no way to leave or be removed', () => {
    renderWorkspaceRow({ isSelf: true, isOwner: true });
    expect(screen.queryByRole('button', { name: 'Remove Alice' })).toBeNull();
  });

  it('offers no removal of the only admin', () => {
    renderWorkspaceRow({ role: 'Admin', adminCount: 1 });
    expect(screen.queryByRole('button', { name: 'Remove Alice' })).toBeNull();
  });

  it('still offers removal of one admin among several', () => {
    renderWorkspaceRow({ role: 'Admin', adminCount: 2 });
    expect(screen.getByRole('button', { name: 'Remove Alice' })).toBeTruthy();
  });
});

function renderFolderRow() {
  render(
    <ul>
      <FolderMemberRoleRow
        folderId="f1"
        identity="bob"
        label="Bob"
        coreRole="Member"
        registryRole="Editor"
        canManage
      />
    </ul>,
  );
}

describe('folder member row', () => {
  it('uses the shared vocabulary, with Viewer shown as Read only', () => {
    caps.value = 0;
    renderFolderRow();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Read only' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Viewer' })).toBeNull();
  });

  it('writes nothing when the role change is cancelled', async () => {
    caps.value = 0;
    confirm.mockResolvedValue(false);
    renderFolderRow();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ReadOnly' } });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0].title).toBe("Change Bob's role to Read only?");
    expect(setFolderRole).not.toHaveBeenCalled();
    expect(setCapabilities).not.toHaveBeenCalled();
  });

  it('writes the folder role and caps once when confirmed', async () => {
    caps.value = 0;
    confirm.mockResolvedValue(true);
    renderFolderRow();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Manager' } });
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledTimes(1));
    expect(setFolderRole).toHaveBeenCalledTimes(1);
    expect(setFolderRole.mock.calls[0][0].role).toBe('Manager');
    expect(setCapabilities).toHaveBeenCalledWith(MANAGER_FOLDER_CAPS);
  });

  it('shows a core admin as the folder Owner, not as a choice', () => {
    render(
      <ul>
        <FolderMemberRoleRow
          folderId="f1"
          identity="bob"
          label="Bob"
          coreRole="Admin"
          registryRole="Editor"
          canManage
        />
      </ul>,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('Owner');
    expect(screen.getByRole('option', { name: 'Owner' })).toBeTruthy();
    expect(select.disabled).toBe(true);
  });
});

describe('leaving a folder', () => {
  it('asks first, and cancel keeps you in', async () => {
    confirm.mockResolvedValue(false);
    render(<FolderSharingPanel folderId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Me' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const opts = confirm.mock.calls[0][0];
    expect(opts.title).toBe('Leave this folder?');
    expect(opts.destructive).toBe(true);
    render(<>{opts.body}</>);
    expect(screen.getByText(/need a new invite/)).toBeTruthy();
    expect(removeMember).not.toHaveBeenCalled();
  });

  it('removes you once when confirmed', async () => {
    confirm.mockResolvedValue(true);
    render(<FolderSharingPanel folderId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Me' }));
    await waitFor(() => expect(removeMember).toHaveBeenCalledTimes(1));
  });
});

// The node never removes a group's owner or its last admin; a folder's core admin is shown as its Owner.
describe('removing a folder owner', () => {
  it.each([false, true])('offers no remove on the Owner row (role editor: %s)', (canManagePermissions) => {
    folderPerms.canManagePermissions = canManagePermissions;
    folderMembers.value = [{ ...ME, role: 'Admin' }, { identity: 'bob', name: 'Bob', role: 'Member' }];
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.queryByRole('button', { name: 'Remove Me' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Bob' })).toBeTruthy();
  });
});

// A folder's member list carries no names; the workspace's names label its rows.
describe('naming folder members', () => {
  it.each([false, true])('names a member by their workspace name (role editor: %s)', (canManagePermissions) => {
    folderPerms.canManagePermissions = canManagePermissions;
    folderMembers.value = [ME, { identity: 'bob', role: 'Member' } as typeof ME];
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.getByRole('button', { name: 'Remove Bob' })).toBeTruthy();
  });
});

describe('making a folder restricted', () => {
  it('asks first, and cancel leaves it open', async () => {
    confirm.mockResolvedValue(false);
    render(<FolderVisibilityToggle folderId="f1" current="Open" />);
    fireEvent.click(screen.getByRole('button', { name: /Make restricted/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0].destructive).toBe(true);
    expect(confirm.mock.calls[0][0].body).toBe(
      'Workspace members you have not added will lose access to this folder and its subfolders.',
    );
    expect(setSubgroupVisibility).not.toHaveBeenCalled();
  });

  it('restricts once when confirmed', async () => {
    confirm.mockResolvedValue(true);
    render(<FolderVisibilityToggle folderId="f1" current="Open" />);
    fireEvent.click(screen.getByRole('button', { name: /Make restricted/ }));
    await waitFor(() => expect(setSubgroupVisibility).toHaveBeenCalledTimes(1));
    expect(setSubgroupVisibility).toHaveBeenCalledWith('f1', {
      subgroupVisibility: 'restricted',
    });
  });

  it('opens a folder without asking', async () => {
    render(<FolderVisibilityToggle folderId="f1" current="Restricted" />);
    fireEvent.click(screen.getByRole('button', { name: /Make open/ }));
    await waitFor(() => expect(setSubgroupVisibility).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });
});
