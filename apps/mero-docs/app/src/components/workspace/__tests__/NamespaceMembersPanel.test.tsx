import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NamespaceMembersPanel } from '../NamespaceMembersPanel';

const BOB = 'b'.repeat(64);
const ME = 'a'.repeat(64);
const listGroupMembers = vi.fn();
const removeGroupMembers = vi.fn();

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ mero: {}, admin: { listGroupMembers, removeGroupMembers } }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'root',
    rootGroupId: 'root',
    namespaces: [],
    selfIdentity: ME,
    registryContextId: null,
    registryAdmin: { owner: ME },
    folders: [
      { id: 'plans', parent_id: null, alias: 'Plans' },
      { id: 'notes', parent_id: null, alias: 'Notes' },
    ],
  }),
}));
vi.mock('@/hooks/useFolderMembership', () => ({
  useFolderMembership: () => ({
    members: [
      { identity: ME, role: 'Admin' },
      { identity: BOB, role: 'Member' },
    ],
    loading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => ({ canManageMembers: true, canInviteMembers: false }),
}));
vi.mock('@/hooks/useMemberCaps', () => ({ useMemberCaps: () => ({ caps: null, isAdmin: true }) }));
vi.mock('@/hooks/useWorkspacePresence', () => ({ useWorkspacePresence: () => new Set() }));
vi.mock('@/hooks/useNamespaceInvitation', () => ({ useCreateNamespaceInvite: () => ({ create: vi.fn() }) }));
vi.mock('@/components/admin/NamespaceMemberRow', () => ({
  NamespaceMemberRow: ({ identity, onRemove }: { identity: string; onRemove: (id: string, l: string) => void }) => (
    <li>
      <button type="button" onClick={() => onRemove(identity, identity === BOB ? 'Bob' : 'Me')}>
        Remove {identity === BOB ? 'Bob' : 'Me'}
      </button>
    </li>
  ),
}));

beforeEach(() => {
  removeGroupMembers.mockReset().mockResolvedValue(undefined);
  listGroupMembers.mockReset().mockImplementation(async (g: string) => ({
    members: g === 'notes' ? [{ identity: BOB }] : [],
  }));
});

describe('NamespaceMembersPanel removal', () => {
  // Core leaves a member's direct folder rows in place when they leave the workspace.
  it('also removes the member from the folders that still list them', async () => {
    render(<NamespaceMembersPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    await waitFor(() =>
      expect(removeGroupMembers).toHaveBeenCalledWith('notes', { members: [BOB] }),
    );
    expect(removeGroupMembers.mock.calls[0]).toEqual(['root', { members: [BOB] }]);
    expect(removeGroupMembers).not.toHaveBeenCalledWith('plans', expect.anything());
  });

  it('names the folders it could not remove them from', async () => {
    removeGroupMembers.mockImplementation(async (g: string) => {
      if (g === 'notes') throw new Error('403');
    });
    render(<NamespaceMembersPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Removed Bob from the workspace, but not from Notes. Ask the owner of each to remove them.',
    );
  });

  it('says why when the workspace removal itself is refused, and touches no folder', async () => {
    removeGroupMembers.mockRejectedValue(new Error('not allowed'));
    render(<NamespaceMembersPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't remove Bob: not allowed");
    expect(listGroupMembers).not.toHaveBeenCalled();
  });
});
