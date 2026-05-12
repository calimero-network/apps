import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderPermissions } from '../useFolderPermissions';
import { CAPABILITIES } from '../../constants/config';
import type { Role } from '../../api/registry/RegistryClient';

// The registry-Role layer (useFolderRole / useRegistryAdmin) is mocked
// so each test can pin a role / owner-or-manager flag independently of
// the (no-op without a registryClient) real hooks. useMemberCaps stays
// real — it's what drives the cap-derived booleans.
const folderRoleState: { role: Role | null; loading: boolean } = {
  role: 'Editor',
  loading: false,
};
const registryAdminState: { isOwnerOrManager: boolean } = {
  isOwnerOrManager: false,
};
vi.mock('../useFolderRole', () => ({
  useFolderRole: () => ({
    role: folderRoleState.role,
    loading: folderRoleState.loading,
    error: null,
    setRole: vi.fn(),
    clearRole: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock('../useRegistryAdmin', () => ({
  useRegistryAdmin: () => ({
    owner: null,
    managers: [],
    isOwnerOrManager: registryAdminState.isOwnerOrManager,
    isOwner: false,
    loading: false,
    error: null,
    addManager: vi.fn(),
    removeManager: vi.fn(),
    claimOwner: vi.fn(),
    refetch: vi.fn(),
  }),
}));

// useFolderPermissions delegates to useMemberCaps, which fetches both
// role and capabilities directly via mero.admin (no dependency on
// mero-react's useGroupCapabilities). Tests drive the mero.admin mocks
// directly. Bit checks use core's `MemberCapabilities` layout
// (re-exported as CAPABILITIES from constants/config).
const listMembersMock = vi.fn();
const getMemberCapsMock = vi.fn();
// Stable mero ref — useMemberCaps's effect deps include `mero`, so a
// new object every render would retrigger the fetch and infinite-loop.
const MERO_STUB = {
  mero: {
    admin: {
      listGroupMembers: listMembersMock,
      getMemberCapabilities: getMemberCapsMock,
    },
  },
};
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => MERO_STUB,
}));

const identityMock: { value: string | null } = { value: 'me' };
// useFolderPermissions no longer reads workspace state — capabilities
// come straight from useMemberCaps now that core PR #2261 handles
// open-subgroup membership inheritance server-side. The mock stays so
// any transitive consumer that imports useDriveWorkspace gets a stub.
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    selfIdentity: identityMock.value,
    loading: false,
    error: null,
    folders: [],
    rootGroupId: 'ns-root',
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
    folderRoleState.role = 'Editor';
    folderRoleState.loading = false;
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
    // (caps stay null) — exercises the loading/isMember boundary.
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

  it('caps-fetch error → isMember false (NOT writable on error)', async () => {
    // useMemberCaps reports `caps = 0, error = Error` when retries are
    // exhausted. `isMember` must be false here — otherwise consumers
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

  it("role 'Viewer' → canEditDocs false even for a folder member", async () => {
    folderRoleState.role = 'Viewer';
    const { result } = renderWithCaps(C.CAN_JOIN_OPEN_SUBGROUPS);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isMember).toBe(true);
    expect(result.current.canEditDocs).toBe(false);
  });

  it("role 'Editor' → canEditDocs true for a folder member", async () => {
    folderRoleState.role = 'Editor';
    const { result } = renderWithCaps(C.CAN_JOIN_OPEN_SUBGROUPS);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canEditDocs).toBe(true);
  });

  it("role 'Manager' → canEditDocs true for a folder member", async () => {
    folderRoleState.role = 'Manager';
    const { result } = renderWithCaps(C.CAN_JOIN_OPEN_SUBGROUPS);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canEditDocs).toBe(true);
  });

  it("isAdmin → canEditDocs true regardless of role ('Viewer')", async () => {
    folderRoleState.role = 'Viewer';
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Admin' }],
    });
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    await waitFor(() => expect(result.current.canEditDocs).toBe(true));
  });

  it('isOwnerOrManager → canManagePermissions true (and canManageGroup)', async () => {
    registryAdminState.isOwnerOrManager = true;
    const { result } = renderWithCaps(0);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canManagePermissions).toBe(true);
    expect(result.current.canManageGroup).toBe(true);
  });

  it("canDelete: CAN_DELETE_SUBGROUP + role 'Manager' → true", async () => {
    folderRoleState.role = 'Manager';
    const { result } = renderWithCaps(C.CAN_DELETE_SUBGROUP);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canDelete).toBe(true);
  });

  it("canDelete: CAN_DELETE_SUBGROUP + role 'Editor' → false", async () => {
    folderRoleState.role = 'Editor';
    const { result } = renderWithCaps(C.CAN_DELETE_SUBGROUP);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canDelete).toBe(false);
  });

  it('Open subgroup: inherited namespace member gets the real cap mask from core', async () => {
    // Per core PR #2261, listGroupMembers + getMemberCapabilities now
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
