import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HTTPError } from '@calimero-network/mero-js';
import { FolderMemberRoleRow } from '../FolderMemberRoleRow';
import { CAPABILITIES } from '@/constants/config';

const FOLDER = 'f'.repeat(64);
const BOB = 'b'.repeat(64);
const CHILD = 'c'.repeat(64);
const WALLED = 'd'.repeat(64);
const PARENT = 'a'.repeat(64);
const JOIN = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS;

const calls: string[] = [];
const updateMemberRole = vi.fn();
const addGroupMembers = vi.fn();
const setFolderRole = vi.fn();
const setCapabilities = vi.fn();
let folderCaps = 0;
// Bob's row in the sub-folder, as its member list reports it.
let childRows: { identity: string; role: string }[] = [];
let folderParent: string | null = null;
let parentRows: { identity: string; role: string }[] = [];
let extraFolders: { id: string; parent_id: string; alias: string }[] = [];
const byFolder = async (g: string) => ({
  members: g === CHILD ? childRows : g === PARENT ? parentRows : [],
});
const listGroupMembers = vi.fn(byFolder);

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({
    mero: {},
    // The session-aware admin (`useMero().admin`) is what the code writes through.
    admin: {
      updateMemberRole,
      addGroupMembers,
      listGroupMembers,
      setMemberCapabilities: setCapabilities,
    },
  }),
  useGroupCapabilities: () => ({
    capabilities: folderCaps,
    loading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    registryClient: { setFolderRole },
    registryContextId: 'reg',
    namespaceId: 'ns',
    namespaceMemberNames: {},
    folders: [
      { id: FOLDER, parent_id: folderParent, alias: 'Plans', visibility: 'Open' },
      { id: PARENT, parent_id: null, alias: 'Team', visibility: 'Open' },
      { id: CHILD, parent_id: FOLDER, alias: 'Notes', visibility: 'Open' },
      { id: WALLED, parent_id: FOLDER, alias: 'Private', visibility: 'Restricted' },
      ...extraFolders,
    ],
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
  childRows = [];
  extraFolders = [];
  folderParent = null;
  listGroupMembers.mockImplementation(byFolder);
  parentRows = [];
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
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledWith(FOLDER, BOB, { capabilities: JOIN }));
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
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledWith(FOLDER, BOB, { capabilities: JOIN }));
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

  it('reports a caps write core refused', async () => {
    setCapabilities.mockRejectedValue(httpError(403));
    const select = roleSelectFor('Member', 'Editor');
    fireEvent.change(select, { target: { value: 'ReadOnly' } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Role update failed/);
  });

  it('lets a Read only member be made an Editor again, restoring the core role first', async () => {
    const select = roleSelectFor('ReadOnly', 'Viewer');
    expect(select.value).toBe('ReadOnly');
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'Editor' } });
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledWith(FOLDER, BOB, { capabilities: JOIN }));
    expect(updateMemberRole).toHaveBeenCalledWith(FOLDER, BOB, {
      role: 'Member',
    });
    expect(calls).toEqual([
      'updateMemberRole',
      'setFolderRole',
      'setCapabilities',
    ]);
  });

  // Read only on a folder covers every sub-folder the member reaches.
  it('carries Read only into the sub-folders, and its end too', async () => {
    // An Open sub-folder lists Bob with his parent row's role.
    childRows = [{ identity: BOB, role: 'ReadOnly' }];
    fireEvent.change(roleSelectFor('Member', 'Editor'), { target: { value: 'ReadOnly' } });
    await waitFor(() =>
      expect(setCapabilities).toHaveBeenCalledWith(CHILD, BOB, { capabilities: JOIN }),
    );
    expect(updateMemberRole).toHaveBeenCalledWith(CHILD, BOB, { role: 'ReadOnly' });
    expect(setFolderRole).toHaveBeenCalledWith(
      expect.objectContaining({ folder_id: CHILD, role: 'Viewer' }),
    );
  });

  // A Restricted sub-folder the member was invited to is its admin's call.
  it('leaves a Restricted sub-folder alone', async () => {
    childRows = [{ identity: BOB, role: 'Member' }];
    listGroupMembers.mockImplementation(async (g: string) => ({
      members: g === CHILD || g === WALLED ? childRows : [],
    }));
    fireEvent.change(roleSelectFor('Member', 'Editor'), { target: { value: 'ReadOnly' } });
    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith(CHILD, BOB, { role: 'ReadOnly' }));
    expect(updateMemberRole).not.toHaveBeenCalledWith(WALLED, expect.anything(), expect.anything());
  });

  it('ends Read only in the sub-folders when the member is made an Editor again', async () => {
    childRows = [{ identity: BOB, role: 'ReadOnly' }];
    fireEvent.change(roleSelectFor('ReadOnly', 'Viewer'), { target: { value: 'Editor' } });
    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith(CHILD, BOB, { role: 'Member' }));
  });

  // Core already says Member here, but the sub-folders may still be Read only.
  it('ends Read only in the sub-folders when only the registry row still says Read only', async () => {
    childRows = [{ identity: BOB, role: 'ReadOnly' }];
    fireEvent.change(roleSelectFor('Member', 'Viewer'), { target: { value: 'Editor' } });
    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith(CHILD, BOB, { role: 'Member' }));
  });

  it('names a sub-folder whose visibility is not known', async () => {
    extraFolders = [{ id: 'e'.repeat(64), parent_id: FOLDER, alias: 'Unread' }];
    fireEvent.change(roleSelectFor('Member', 'Editor'), { target: { value: 'ReadOnly' } });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Role set here, but not in Unread. Ask the owner of each to set it.',
    );
  });

  // A direct row here does not lift a parent's Read only, which covers this folder.
  it('refuses Editor under a parent that holds the member Read only, even with a row here', async () => {
    folderParent = PARENT;
    parentRows = [{ identity: BOB, role: 'ReadOnly' }];
    childRows = [{ identity: BOB, role: 'ReadOnly' }];
    fireEvent.change(roleSelectFor('ReadOnly', 'Viewer'), { target: { value: 'Editor' } });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Read only here comes from a parent folder. Change it there.',
    );
    expect(updateMemberRole).not.toHaveBeenCalled();
    expect(setFolderRole).not.toHaveBeenCalled();
  });

  // Core lists them ReadOnly through a parent folder, with no row here to change.
  it('says so when Read only comes from a parent folder', async () => {
    updateMemberRole.mockRejectedValue(httpError(404));
    fireEvent.change(roleSelectFor('ReadOnly', 'Editor'), { target: { value: 'Editor' } });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Read only here comes from a parent folder. Change it there.',
    );
    expect(setFolderRole).not.toHaveBeenCalled();
  });

  it('names the sub-folders it could not make Read only', async () => {
    childRows = [{ identity: BOB, role: 'Member' }];
    updateMemberRole.mockImplementation(async (g: string) => {
      if (g === CHILD) throw httpError(403);
    });
    fireEvent.change(roleSelectFor('Member', 'Editor'), { target: { value: 'ReadOnly' } });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Role set here, but not in Notes. Ask the owner of each to set it.',
    );
  });

  it('moves between Editor and Manager without touching the core role', async () => {
    const select = roleSelectFor('Member', 'Editor');
    fireEvent.change(select, { target: { value: 'Manager' } });
    await waitFor(() => expect(setCapabilities).toHaveBeenCalled());
    expect(updateMemberRole).not.toHaveBeenCalled();
    expect(addGroupMembers).not.toHaveBeenCalled();
  });

  // A Viewer row from before Read only wrote the core role: nothing enforces it.
  it('says a Read only row core does not enforce is not enforced, and applies it in one click', async () => {
    roleSelectFor('Member', 'Viewer');
    expect(screen.getByText('Read only, but not enforced.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enforce' }));
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledWith(FOLDER, BOB, { capabilities: JOIN }));
    expect(updateMemberRole).toHaveBeenCalledWith(FOLDER, BOB, { role: 'ReadOnly' });
    expect(calls).toEqual(['updateMemberRole', 'setFolderRole', 'setCapabilities']);
  });

  it('says nothing about enforcement for an enforced Read only row', () => {
    roleSelectFor('ReadOnly', 'Viewer');
    expect(screen.queryByText('Read only, but not enforced.')).toBeNull();
  });

  it('keeps a TEE row fixed', () => {
    expect(roleSelectFor('ReadOnlyTee', 'Editor').disabled).toBe(true);
  });

  it("keeps a folder owner's row fixed", () => {
    expect(roleSelectFor('Admin', 'Editor').disabled).toBe(true);
  });
});
