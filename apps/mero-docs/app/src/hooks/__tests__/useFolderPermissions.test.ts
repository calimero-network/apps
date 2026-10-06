import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { HTTPError } from '@calimero-network/mero-js';
import { useFolderPermissions } from '../useFolderPermissions';
import { CAPABILITIES } from '../../constants/config';
import { MANAGER_FOLDER_CAPS } from '../../lib/roles';

// The owner-or-manager flag lives on useDriveWorkspace().registryAdmin
// (hoisted) - pinned via the useDriveWorkspace mock below. useMemberCaps
// stays real: it's what drives every boolean, the documents role included.
const registryAdminState: { isOwnerOrManager: boolean } = {
  isOwnerOrManager: false,
};

// useFolderPermissions delegates to useMemberCaps, which fetches both
// role and capabilities directly via mero.admin (no dependency on
// mero-react's useGroupCapabilities). Tests drive the mero.admin mocks
// directly. Bit checks use core's `MemberCapabilities` layout
// (re-exported as CAPABILITIES from constants/config).
const listMembersMock = vi.fn();
const getMemberCapsMock = vi.fn();
// Stable mero ref - useMemberCaps's effect deps include `mero`, so a
// new object every render would retrigger the fetch and infinite-loop.
const MERO_STUB = {
  mero: {},
  // The session-aware admin (`useMero().admin`) is what the code writes through.
  admin: {
    listGroupMembers: listMembersMock,
    getMemberCapabilities: getMemberCapsMock,
  },
};
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: vi.fn(),
  useMero: () => MERO_STUB,
}));

const identityMock: { value: string | null } = { value: 'me' };
// useFolderPermissions no longer reads workspace state - capabilities
// come straight from useMemberCaps now that core handles
// open-subgroup membership inheritance server-side. The mock stays so
// any transitive consumer that imports useDriveWorkspace gets a stub.
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    selfIdentity: identityMock.value,
    loading: false,
    error: null,
    folders: [],
    rootGroupId: 'ns-root',
    registryAdmin: {
      owner: null,
      managers: [] as string[],
      isOwnerOrManager: registryAdminState.isOwnerOrManager,
      isOwner: false,
      loading: false,
      error: null,
      addManager: vi.fn(),
      removeManager: vi.fn(),
      refetch: vi.fn(),
    },
  }),
}));

const C = CAPABILITIES;

describe('useFolderPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.value = 'me';
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Member' }],
    });
    getMemberCapsMock.mockResolvedValue({ capabilities: 0 });
    registryAdminState.isOwnerOrManager = false;
  });

  const renderWithCaps = (caps: number) => {
    getMemberCapsMock.mockResolvedValue({ capabilities: caps });
    return renderHook(() => useFolderPermissions('ns', 'folder-1'));
  };

  it('CAN_CREATE_SUBGROUP permits canCreateSubfolder only', async () => {
    const { result } = renderWithCaps(C.CAN_CREATE_SUBGROUP);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isMember).toBe(true);
    expect(result.current.canCreateSubfolder).toBe(true);
    expect(result.current.canRename).toBe(false);
    expect(result.current.canManageVisibility).toBe(false);
    expect(result.current.canDelete).toBe(false);
    expect(result.current.canInviteMembers).toBe(false);
    expect(result.current.canManageMembers).toBe(false);
    // canCreateSubfolder is not "admin-ish" so the aggregate stays false.
    expect(result.current.canManageGroup).toBe(false);
  });

  it('CAN_MANAGE_METADATA permits canRename + canManageGroup, not delete', async () => {
    const { result } = renderWithCaps(C.CAN_MANAGE_METADATA);
    await waitFor(() => expect(result.current.canRename).toBe(true));
    expect(result.current.canManageGroup).toBe(true);
    expect(result.current.canDelete).toBe(false);
    expect(result.current.canManageVisibility).toBe(false);
  });

  it('MANAGE_MEMBERS|CAN_INVITE_MEMBERS permits both + canManageGroup', async () => {
    const { result } = renderWithCaps(C.MANAGE_MEMBERS | C.CAN_INVITE_MEMBERS);
    await waitFor(() => expect(result.current.canManageMembers).toBe(true));
    expect(result.current.canInviteMembers).toBe(true);
    expect(result.current.canManageGroup).toBe(true);
    expect(result.current.canRename).toBe(false);
    expect(result.current.canDelete).toBe(false);
  });

  it('Admin role short-circuits to all caps (no getMemberCapabilities call)', async () => {
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Admin' }],
    });
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    await waitFor(() => expect(result.current.canDelete).toBe(true));
    expect(result.current.isMember).toBe(true);
    expect(result.current.canRename).toBe(true);
    expect(result.current.canManageVisibility).toBe(true);
    expect(result.current.canInviteMembers).toBe(true);
    expect(result.current.canManageMembers).toBe(true);
    expect(result.current.canCreateSubfolder).toBe(true);
    expect(result.current.canManageGroup).toBe(true);
    expect(getMemberCapsMock).not.toHaveBeenCalled();
  });

  it('null caps → loading true, isMember false', async () => {
    // Drop the identity so the hook short-circuits to its loading state
    // (caps stay null) - exercises the loading/isMember boundary.
    identityMock.value = null;
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    expect(result.current.loading).toBe(true);
    expect(result.current.isMember).toBe(false);
  });

  it('surfaces non-propagation errors without retrying forever', async () => {
    const boom = new Error('database gone');
    listMembersMock.mockRejectedValue(boom);
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-x'));
    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.canManageGroup).toBe(false);
  });

  it('reports a member core no longer finds in the folder as removed, without retrying', async () => {
    getMemberCapsMock.mockRejectedValue(
      new HTTPError(404, '', '/groups/folder-1/members/bob/capabilities', new Headers()),
    );
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    await waitFor(() => expect(result.current.removed).toBe(true));
    expect(getMemberCapsMock).toHaveBeenCalledTimes(1);
    expect(result.current.denied).toBe(false);
    expect(result.current.isMember).toBe(false);
  });

  it('reports a folder whose group has not synced to this node as notSynced, not removed', async () => {
    getMemberCapsMock.mockRejectedValue(
      new HTTPError(
        404,
        '',
        '/groups/folder-1/members/bob/capabilities',
        new Headers(),
        '{"error":"group \'folder-1\' not found"}',
      ),
    );
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    await waitFor(() => expect(result.current.notSynced).toBe(true));
    expect(result.current.removed).toBe(false);
    expect(result.current.denied).toBe(false);
    expect(result.current.isMember).toBe(false);
  });

  it('caps-fetch error → isMember false (NOT writable on error)', async () => {
    // useMemberCaps reports `caps = 0, error = Error` when retries are
    // exhausted. `isMember` must be false here - otherwise consumers
    // that gate on `perms.isMember` (e.g. the doc editor's
    // `canEditDocs`) would become writable on a transient fetch
    // failure, a regression from the old `canWrite` (false on error
    // since caps=0 has no bits set).
    const boom = new Error('caps service unavailable');
    getMemberCapsMock.mockRejectedValue(boom);
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-y'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(boom);
    expect(result.current.isMember).toBe(false);
    expect(result.current.canEditDocs).toBe(false);
    expect(result.current.canManageGroup).toBe(false);
  });

  it('a folder member core does not hold ReadOnly can edit, as an Editor', async () => {
    const { result } = renderWithCaps(C.CAN_JOIN_OPEN_SUBGROUPS);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.role).toBe('Editor');
    expect(result.current.canEditDocs).toBe(true);
  });

  it('the folder Manager caps read as a Manager, who can edit', async () => {
    const { result } = renderWithCaps(MANAGER_FOLDER_CAPS | C.CAN_JOIN_OPEN_SUBGROUPS);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.role).toBe('Manager');
    expect(result.current.canEditDocs).toBe(true);
  });

  // Core discards a ReadOnly member's writes, so the UI must not offer one.
  it('core ReadOnly on the folder → a Viewer, and canEditDocs false', async () => {
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'ReadOnly' }],
    });
    const { result } = renderWithCaps(C.CAN_JOIN_OPEN_SUBGROUPS);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isMember).toBe(true);
    expect(result.current.role).toBe('Viewer');
    expect(result.current.canEditDocs).toBe(false);
  });

  it('isAdmin → canEditDocs true', async () => {
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Admin' }],
    });
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    await waitFor(() => expect(result.current.canEditDocs).toBe(true));
  });

  it('caps still loading → canEditDocs false, role unknown', () => {
    getMemberCapsMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    expect(result.current.roleLoading).toBe(true);
    expect(result.current.role).toBeNull();
    expect(result.current.canEditDocs).toBe(false);
  });

  // Core takes a folder's role changes from its direct admin only.
  it('a registry owner or manager who is not a folder admin cannot set folder roles', async () => {
    registryAdminState.isOwnerOrManager = true;
    const { result } = renderWithCaps(0);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canManagePermissions).toBe(false);
    expect(result.current.permissionsNeedOwner).toBe(true);
    expect(result.current.canManageGroup).toBe(false);
  });

  it('a folder admin can set folder roles', async () => {
    listMembersMock.mockResolvedValue({ members: [{ identity: 'me', role: 'Admin' }] });
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    await waitFor(() => expect(result.current.canManagePermissions).toBe(true));
    expect(result.current.permissionsNeedOwner).toBe(false);
  });

  it('isOwnerOrManager + any folder cap → canManageGroup true (driven by the cap)', async () => {
    registryAdminState.isOwnerOrManager = true;
    const { result } = renderWithCaps(C.CAN_MANAGE_METADATA);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canManageGroup).toBe(true);
  });

  it('canDelete: CAN_DELETE_SUBGROUP → true', async () => {
    const { result } = renderWithCaps(C.CAN_DELETE_SUBGROUP);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canDelete).toBe(true);
  });

  it('canDelete: no CAN_DELETE_SUBGROUP → false', async () => {
    const { result } = renderWithCaps(0);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canDelete).toBe(false);
  });

  it('Open subgroup: inherited namespace member gets the real cap mask from core', async () => {
    // listGroupMembers + getMemberCapabilities now
    // resolve via the parent-walk for Open subgroups. The hook just
    // forwards what core returns; no app-layer fallback. A namespace
    // member with the default-on join bit who's been granted real
    // folder caps (here CAN_CREATE_SUBGROUP) sees those caps.
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Member' }],
    });
    getMemberCapsMock.mockResolvedValue({
      capabilities: C.CAN_JOIN_OPEN_SUBGROUPS | C.CAN_CREATE_SUBGROUP,
    });
    const { result } = renderHook(() =>
      useFolderPermissions('ns', 'folder-1'),
    );
    await waitFor(() => expect(result.current.canCreateSubfolder).toBe(true));
    expect(result.current.isMember).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
