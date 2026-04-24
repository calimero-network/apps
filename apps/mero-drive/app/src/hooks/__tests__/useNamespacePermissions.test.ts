import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNamespacePermissions } from '../useNamespacePermissions';
import { CAP } from '../../constants/config';

// useNamespacePermissions goes through useMemberCaps, which now
// fetches role + capabilities directly via mero.admin. Tests drive
// those mocks.
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

describe('useNamespacePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Member' }],
    });
    getMemberCapsMock.mockResolvedValue({ capabilities: 0 });
  });

  it('derives canCreateSubgroup from CREATE_GROUP bit', async () => {
    getMemberCapsMock.mockResolvedValue({ capabilities: CAP.CREATE_GROUP });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canCreateSubgroup).toBe(true);
    expect(result.current.canManageNamespace).toBe(false);
  });

  it('canManageNamespace requires MANAGE_GROUP', async () => {
    getMemberCapsMock.mockResolvedValue({ capabilities: CAP.MANAGE_GROUP });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.canManageNamespace).toBe(true));
  });

  it('exposes error when the fetch fails with a non-propagation error', async () => {
    const boom = new Error('network down');
    listMembersMock.mockRejectedValue(boom);
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.canManageNamespace).toBe(false);
  });
});
