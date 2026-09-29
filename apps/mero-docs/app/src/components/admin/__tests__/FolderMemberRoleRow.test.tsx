import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HTTPError } from '@calimero-network/mero-js';
import { FolderMemberRoleRow } from '../FolderMemberRoleRow';

const FOLDER = 'f'.repeat(64);
const BOB = 'b'.repeat(64);

const calls: string[] = [];
const updateMemberRole = vi.fn();
const addGroupMembers = vi.fn();
const setFolderRole = vi.fn();
const setCapabilities = vi.fn();
let folderCaps = 0;

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ mero: { admin: { updateMemberRole, addGroupMembers } } }),
  useGroupCapabilities: () => ({
    capabilities: folderCaps,
    loading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
    setCapabilities,
  }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    registryClient: { setFolderRole },
    registryContextId: 'reg',
    namespaceId: 'ns',
    namespaceMemberNames: {},
  }),
}));
vi.mock('@/hooks/useContextEvents', () => ({ useContextEvents: vi.fn() }));
vi.mock('@/hooks/useMemberName', () => ({
  useMemberName: () => ({ name: 'Bob', settled: true }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => async () => true,
}));

const httpError = (status: number) =>
  new HTTPError(
    status,
    '',
    `/admin-api/groups/${FOLDER}/members/${BOB}/role`,
    new Headers(),
  );

function roleSelectFor(
  coreRole: string,
  registryRole: 'Viewer' | 'Editor' | 'Manager',
) {
  render(
    <FolderMemberRoleRow
      folderId={FOLDER}
      identity={BOB}
      coreRole={coreRole}
      registryRole={registryRole}
      canManage
    />,
  );
  return screen.getByRole('combobox', {
    name: 'Role for Bob',
  }) as HTMLSelectElement;
}

beforeEach(() => {
  calls.length = 0;
  folderCaps = 0;
  const record = (name: string) => async () => {
    calls.push(name);
  };
  updateMemberRole.mockReset().mockImplementation(record('updateMemberRole'));
  addGroupMembers.mockReset().mockImplementation(record('addGroupMembers'));
  setFolderRole.mockReset().mockImplementation(record('setFolderRole'));
  setCapabilities.mockReset().mockImplementation(record('setCapabilities'));
});

describe('FolderMemberRoleRow', () => {
  it('makes a Read only member core ReadOnly in the folder before anything else', async () => {
    const select = roleSelectFor('Member', 'Editor');
    fireEvent.change(select, { target: { value: 'ReadOnly' } });
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledWith(0));
    expect(updateMemberRole).toHaveBeenCalledWith(FOLDER, BOB, {
      role: 'ReadOnly',
    });
    expect(setFolderRole).toHaveBeenCalledWith(
      expect.objectContaining({ member: BOB, role: 'Viewer' }),
    );
    expect(calls).toEqual([
      'updateMemberRole',
      'setFolderRole',
      'setCapabilities',
    ]);
    expect(addGroupMembers).not.toHaveBeenCalled();
  });

  // Core has no direct row to update for a member who only inherits an Open folder.
  it('adds a direct ReadOnly row for a member the folder does not list directly', async () => {
    updateMemberRole.mockRejectedValue(httpError(404));
    const select = roleSelectFor('Member', 'Editor');
    fireEvent.change(select, { target: { value: 'ReadOnly' } });
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledWith(0));
    expect(addGroupMembers).toHaveBeenCalledWith(FOLDER, {
      members: [{ identity: BOB, role: 'ReadOnly' }],
    });
    expect(calls).toEqual([
      'addGroupMembers',
      'setFolderRole',
      'setCapabilities',
    ]);
  });

  it('writes nothing else when core refuses the role', async () => {
    updateMemberRole.mockRejectedValue(httpError(403));
    const select = roleSelectFor('Member', 'Editor');
    fireEvent.change(select, { target: { value: 'ReadOnly' } });
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Role update failed/,
    );
    expect(addGroupMembers).not.toHaveBeenCalled();
    expect(setFolderRole).not.toHaveBeenCalled();
    expect(setCapabilities).not.toHaveBeenCalled();
  });

  it('lets a Read only member be made an Editor again, restoring the core role first', async () => {
    const select = roleSelectFor('ReadOnly', 'Viewer');
    expect(select.value).toBe('ReadOnly');
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'Editor' } });
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledWith(0));
    expect(updateMemberRole).toHaveBeenCalledWith(FOLDER, BOB, {
      role: 'Member',
    });
    expect(calls).toEqual([
      'updateMemberRole',
      'setFolderRole',
      'setCapabilities',
    ]);
  });

  it('moves between Editor and Manager without touching the core role', async () => {
    const select = roleSelectFor('Member', 'Editor');
    fireEvent.change(select, { target: { value: 'Manager' } });
    await waitFor(() => expect(setCapabilities).toHaveBeenCalled());
    expect(updateMemberRole).not.toHaveBeenCalled();
    expect(addGroupMembers).not.toHaveBeenCalled();
  });

  it('keeps a TEE row fixed', () => {
    expect(roleSelectFor('ReadOnlyTee', 'Editor').disabled).toBe(true);
  });

  it("keeps a folder owner's row fixed", () => {
    expect(roleSelectFor('Admin', 'Editor').disabled).toBe(true);
  });
});
