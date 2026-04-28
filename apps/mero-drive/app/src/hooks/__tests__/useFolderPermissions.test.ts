import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderPermissions } from '../useFolderPermissions';
import { CAP } from '../../constants/config';

// useFolderPermissions delegates to useMemberCaps, which now fetches
// both role and capabilities directly via mero.admin (no dependency
// on mero-react's useGroupCapabilities). Tests drive the mero.admin
// mocks directly.
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

describe('useFolderPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.value = 'me';
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Member' }],
    });
    getMemberCapsMock.mockResolvedValue({ capabilities: 0 });
  });

  const renderWithCaps = (caps: number) => {
    getMemberCapsMock.mockResolvedValue({ capabilities: caps });
    return renderHook(() => useFolderPermissions('ns', 'folder-1'));
  };

  it('READ permits canRead only', async () => {
    const { result } = renderWithCaps(CAP.READ);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it('WRITE permits write, not delete', async () => {
    const { result } = renderWithCaps(CAP.READ | CAP.WRITE);
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.canDelete).toBe(false);
  });

  it('MANAGE_GROUP permits delete + rename + visibility', async () => {
    const { result } = renderWithCaps(CAP.MANAGE_GROUP);
    await waitFor(() => expect(result.current.canDelete).toBe(true));
    expect(result.current.canRename).toBe(true);
    expect(result.current.canManageGroup).toBe(true);
  });

  it('Admin role short-circuits to all caps (no getMemberCapabilities call)', async () => {
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Admin' }],
    });
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    await waitFor(() => expect(result.current.canDelete).toBe(true));
    expect(result.current.canManageGroup).toBe(true);
    expect(getMemberCapsMock).not.toHaveBeenCalled();
  });

  it('surfaces non-propagation errors without retrying forever', async () => {
    const boom = new Error('database gone');
    listMembersMock.mockRejectedValue(boom);
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-x'));
    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.canRead).toBe(false);
  });

  it('Open subgroup: inherited namespace member gets the real cap mask from core', async () => {
    // Per core PR #2261, listGroupMembers + getMemberCapabilities now
    // resolve via the parent-walk for Open subgroups. The hook just
    // forwards what core returns; no app-layer fallback.
    listMembersMock.mockResolvedValue({
      members: [{ identity: 'me', role: 'Member' }],
    });
    getMemberCapsMock.mockResolvedValue({
      capabilities: CAP.READ | CAP.WRITE,
    });
    const { result } = renderHook(() =>
      useFolderPermissions('ns', 'folder-1'),
    );
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.canRead).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
