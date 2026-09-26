import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FolderSharingPanel } from '../FolderSharingPanel';

const NAMED = 'a'.repeat(64);
const UNNAMED = 'b'.repeat(64);
const PICKED = 'c'.repeat(64);

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    folders: [{ id: 'f1', alias: 'Plans', visibility: 'Restricted' }],
    selfIdentity: null,
    registryContextId: null,
    namespaceMemberNames: { [PICKED]: 'Carol' },
  }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: () => ({ name: null }),
}));
vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: () => ({
    canManagePermissions: false,
    canManageMembers: true,
    canInviteMembers: true,
  }),
}));
vi.mock('@/hooks/useFolderMembership', () => ({
  useFolderMembership: () => ({
    members: [
      { identity: NAMED, name: 'Bob', role: 'Member' },
      { identity: UNNAMED, role: 'ReadOnly' },
    ],
    loading: false,
    error: null,
    add: vi.fn(),
    remove: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useFolderRole', () => ({
  useFolderRoles: () => ({ entries: [], refetch: vi.fn() }),
}));
vi.mock('@/hooks/useNamespaceInvitation', () => ({
  useCreateFolderInvite: () => ({ create: vi.fn() }),
}));
vi.mock('@/hooks/useContextEvents', () => ({ useContextEvents: vi.fn() }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => async () => false,
}));
vi.mock('@/components/common/MemberPicker', () => ({
  MemberPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect(PICKED)}>
      Pick member
    </button>
  ),
}));

describe('FolderSharingPanel read-only rows', () => {
  it('labels an unnamed member with the shared fallback, never a key', () => {
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.getByRole('button', { name: 'Remove Bob' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Unnamed member' })).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
  });

  it('echoes a picked member by name, not by key', () => {
    render(<FolderSharingPanel folderId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick member' }));
    expect(screen.getByText('Carol')).toBeTruthy();
    expect(screen.queryByText(new RegExp(PICKED.slice(0, 16)))).toBeNull();
  });
});
