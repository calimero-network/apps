import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FolderSharingPanel } from '../FolderSharingPanel';

const NAMED = 'a'.repeat(64);
const UNNAMED = 'b'.repeat(64);
const PICKED = 'c'.repeat(64);
const confirm = vi.fn();
const addMember = vi.fn();
const listGroupMembers = vi.fn();
const addGroupMembers = vi.fn();
const updateMemberRole = vi.fn();
const setMemberCapabilities = vi.fn();
const setFolderRole = vi.fn();
const workspace = { parentId: null as string | null };
const perms = { canManagePermissions: false, permissionsNeedOwner: false };
// Per member: the name their own metadata read answered with, and whether it has answered.
const metadata = { names: {} as Record<string, string>, answered: new Set<string>() };

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    folders: [{ id: 'f1', parent_id: workspace.parentId, alias: 'Plans', visibility: 'Restricted' }],
    selfIdentity: null,
    registryContextId: null,
    registryClient: { setFolderRole },
    namespaceMemberNames: { [NAMED]: 'Bob', [PICKED]: 'Carol' },
  }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: (_ns: string, id: string) => ({
    name: metadata.names[id] ?? null,
    loaded: metadata.answered.has(id),
  }),
}));
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({
    mero: { admin: { listGroupMembers, addGroupMembers, updateMemberRole, setMemberCapabilities } },
  }),
  useGroupCapabilities: () => ({
    capabilities: 0,
    loading: false,
    error: null,
    refetch: vi.fn(),
    setCapabilities: vi.fn(),
  }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({
    canManagePermissions: perms.canManagePermissions,
    permissionsNeedOwner: perms.permissionsNeedOwner,
    canManageMembers: true,
    canInviteMembers: true,
  }),
}));
vi.mock('@/hooks/useFolderMembership', () => ({
  useFolderMembership: () => ({
    members: [
      { identity: NAMED, role: 'Member' },
      { identity: UNNAMED, role: 'ReadOnly' },
    ],
    loading: false,
    error: null,
    add: addMember,
    remove: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useFolderRole', () => ({
  useFolderRoles: () => ({
    entries: [{ member: UNNAMED, role: 'Viewer' }],
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useNamespaceInvitation', () => ({
  useCreateFolderInvite: () => ({ create: vi.fn() }),
}));
vi.mock('@/hooks/useContextEvents', () => ({ useContextEvents: vi.fn() }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => confirm,
}));
vi.mock('@/components/common/MemberPicker', () => ({
  MemberPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect(PICKED)}>
      Pick member
    </button>
  ),
}));

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(false);
  perms.canManagePermissions = false;
  perms.permissionsNeedOwner = false;
  workspace.parentId = null;
  for (const fn of [addMember, addGroupMembers, updateMemberRole, setMemberCapabilities, setFolderRole]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  listGroupMembers.mockReset().mockResolvedValue({ members: [] });
  metadata.names = {};
  metadata.answered = new Set([NAMED, UNNAMED]);
});

describe('FolderSharingPanel read-only rows', () => {
  it('labels an unnamed member with the shared fallback, never a key', () => {
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.getByRole('button', { name: 'Remove Bob' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Unnamed member' })).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
  });

  it('uses the same remove icon as every other member row, not a bare glyph', () => {
    render(<FolderSharingPanel folderId="f1" />);
    const removeButton = screen.getByRole('button', { name: 'Remove Bob' });
    // The icon carries no accessible role; identifying it requires direct DOM access.
    // eslint-disable-next-line testing-library/no-node-access
    expect(removeButton.querySelector('.lucide-trash-2')).toBeTruthy();
  });

  it('echoes a picked member by name, not by key', () => {
    render(<FolderSharingPanel folderId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick member' }));
    expect(screen.getByText('Carol')).toBeTruthy();
    expect(screen.queryByText(new RegExp(PICKED.slice(0, 16)))).toBeNull();
  });
});

describe('folder roles', () => {
  // Read only on the parent covers this sub-folder, even for someone added later.
  it('makes a member who is Read only in the parent folder Read only here when added', async () => {
    workspace.parentId = 'p0';
    listGroupMembers.mockImplementation(async (g: string) => ({
      members: [{ identity: PICKED, role: g === 'p0' ? 'ReadOnly' : 'Member' }],
    }));
    render(<FolderSharingPanel folderId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick member' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(updateMemberRole).toHaveBeenCalledWith('f1', PICKED, { role: 'ReadOnly' }),
    );
    expect(addMember).toHaveBeenCalledWith(PICKED);
  });

  it("tells a registry manager who is not the folder's admin why roles are fixed", () => {
    perms.permissionsNeedOwner = true;
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.getByText("Only this folder's owner can change roles.")).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Role for/ })).toBeNull();
  });
});

describe('member names in labels', () => {
  it("prefers the member's own name over the workspace list", () => {
    metadata.names = { [NAMED]: 'Bobby' };
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.getByRole('button', { name: 'Remove Bobby' })).toBeTruthy();
  });

  it.each([false, true])(
    'never calls a member unnamed while their name loads (role editor: %s)',
    (canManagePermissions) => {
      perms.canManagePermissions = canManagePermissions;
      metadata.answered = new Set([NAMED]);
      const { container } = render(<FolderSharingPanel folderId="f1" />);
      expect(screen.getByRole('button', { name: 'Remove member' })).toBeTruthy();
      // aria-label is an attribute, so only a DOM query can scan all of them.
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
      const labels = [...container.querySelectorAll('[aria-label]')].map((el) =>
        el.getAttribute('aria-label'),
      );
      expect(labels.filter((l) => l?.includes('Unnamed'))).toEqual([]);
    },
  );

  it('asks about a role change without a name while it loads', async () => {
    perms.canManagePermissions = true;
    metadata.answered = new Set([NAMED]);
    render(<FolderSharingPanel folderId="f1" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Member role' }), {
      target: { value: 'Manager' },
    });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0].title).toBe('Change role to Manager?');
  });
});
