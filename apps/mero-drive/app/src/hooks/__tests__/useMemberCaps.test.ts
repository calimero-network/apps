import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMemberCaps } from '../useMemberCaps';

// useMemberCaps fetches members + capabilities straight off
// `mero.admin` and reads the caller identity from useDriveWorkspace.
// Both are mocked so each test pins the server responses directly.
// The hook has no other imports — notably it does NOT touch
// constants/config, so this file is insulated from the mero-js
// CAPABILITIES re-export.

const listMembers = vi.fn();
const getCaps = vi.fn();
// Stable mero ref — the effect deps include `mero`; a fresh object
// every render would retrigger the fetch and infinite-loop.
const MERO_STUB = {
  mero: {
    admin: {
      listGroupMembers: listMembers,
      getMemberCapabilities: getCaps,
    },
  },
};
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => MERO_STUB,
}));

const identity: { value: string | null } = { value: 'bob' };
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ selfIdentity: identity.value }),
}));

// A u32 with every bit set — what the hook reports as `caps` for a
// group-admin (mirrors ADMIN_CAPS_BITMASK in the hook).
const ADMIN_MASK = 0xffffffff >>> 0;

describe('useMemberCaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.value = 'bob';
    listMembers.mockResolvedValue({
      members: [{ identity: 'bob', role: 'Member' }],
    });
    getCaps.mockResolvedValue({ capabilities: 0 });
  });

  it('resolves the capability mask for a direct non-admin member', async () => {
    getCaps.mockResolvedValue({ capabilities: 5 });
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.caps).not.toBeNull());
    expect(result.current.caps).toBe(5);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('short-circuits an Admin role without calling getMemberCapabilities', async () => {
    listMembers.mockResolvedValue({
      members: [{ identity: 'bob', role: 'Admin' }],
    });
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.isAdmin).toBe(true));
    expect(result.current.caps).toBe(ADMIN_MASK);
    expect(result.current.error).toBeNull();
    expect(getCaps).not.toHaveBeenCalled();
  });

  it('surfaces a non-propagation error without exhausting retries', async () => {
    const boom = new Error('database gone');
    listMembers.mockRejectedValue(boom);
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.caps).toBe(0);
  });

  it('refetch() re-runs the membership probe', async () => {
    getCaps.mockResolvedValue({ capabilities: 1 });
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.caps).toBe(1));
    getCaps.mockResolvedValue({ capabilities: 7 });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.caps).toBe(7));
  });

  // The behaviour core PR #2379 unblocks: an inherited Open-subgroup
  // member has no materialised GroupMember row, so listGroupMembers
  // omits them entirely. getMemberCapabilities resolves them (returns
  // 0) rather than throwing "not a member". The hook must treat that
  // success as membership instead of bailing at the members-list miss.
  it(
    'resolves an inherited member absent from the members list',
    async () => {
      listMembers.mockResolvedValue({
        members: [{ identity: 'alice', role: 'Admin' }],
      });
      getCaps.mockResolvedValue({ capabilities: 0 });
      const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
      await waitFor(() => expect(result.current.caps).not.toBeNull(), {
        timeout: 9000,
      });
      expect(getCaps).toHaveBeenCalledWith('g1', 'bob');
      expect(result.current.caps).toBe(0);
      expect(result.current.error).toBeNull();
    },
    12000,
  );
});
