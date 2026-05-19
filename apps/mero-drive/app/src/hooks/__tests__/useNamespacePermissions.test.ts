import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNamespacePermissions } from '../useNamespacePermissions';
import { CAPABILITIES } from '../../constants/config';

// useNamespacePermissions goes through useMemberCaps, which fetches
// role + capabilities directly via mero.admin. Tests drive those
// mocks. Bit checks use core's `MemberCapabilities` layout
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

vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    selfIdentity: 'me',
    loading: false,
    error: null,
  }),
}));

const C = CAPABILITIES;

describe('useNamespacePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Member' }],
    });
    getMemberCapsMock.mockResolvedValue({ capabilities: 0 });
  });

  it('derives canCreateFolder from CAN_CREATE_SUBGROUP bit', async () => {
    getMemberCapsMock.mockResolvedValue({ capabilities: C.CAN_CREATE_SUBGROUP });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canCreateFolder).toBe(true);
    expect(result.current.canManageNamespace).toBe(false);
  });

  it('derives canJoinOpenFolders + canCreateContext from their bits', async () => {
    getMemberCapsMock.mockResolvedValue({
      capabilities: C.CAN_JOIN_OPEN_SUBGROUPS | C.CAN_CREATE_CONTEXT,
    });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.canJoinOpenFolders).toBe(true));
    expect(result.current.canCreateContext).toBe(true);
    expect(result.current.canCreateFolder).toBe(false);
    expect(result.current.canManageNamespace).toBe(false);
  });

  it('canManageNamespace requires an admin-ish bit (MANAGE_MEMBERS)', async () => {
    getMemberCapsMock.mockResolvedValue({ capabilities: C.MANAGE_MEMBERS });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.canManageNamespace).toBe(true));
    expect(result.current.canManageMembers).toBe(true);
    expect(result.current.canManageMetadata).toBe(false);
  });

  it('canManageNamespace also true for CAN_MANAGE_METADATA / CAN_MANAGE_VISIBILITY / CAN_INVITE_MEMBERS', async () => {
    getMemberCapsMock.mockResolvedValue({ capabilities: C.CAN_MANAGE_METADATA });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.canManageMetadata).toBe(true));
    expect(result.current.canManageNamespace).toBe(true);
  });

  it('Admin role short-circuits to all caps', async () => {
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Admin' }],
    });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.canManageNamespace).toBe(true));
    expect(result.current.canCreateFolder).toBe(true);
    expect(result.current.canJoinOpenFolders).toBe(true);
    expect(result.current.canCreateContext).toBe(true);
    expect(result.current.canManageMembers).toBe(true);
    expect(getMemberCapsMock).not.toHaveBeenCalled();
  });

  it('exposes error when the fetch fails with a non-propagation error', async () => {
    const boom = new Error('network down');
    listMembersMock.mockRejectedValue(boom);
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.canManageNamespace).toBe(false);
  });
});
