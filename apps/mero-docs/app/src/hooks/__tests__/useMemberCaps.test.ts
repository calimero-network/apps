import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { SseEventData } from '@calimero-network/mero-react';
import { AuthRevokedError, HTTPError } from '@calimero-network/mero-js';
import { useMemberCaps } from '../useMemberCaps';

const httpError = (status: number, body: string) =>
  new HTTPError(status, '', '/admin-api/groups/g', new Headers(), body);
// core's typed refusal for a caller that is not in the group
const notAMember = () => httpError(403, '{"error":"identity is not a member of group g"}');

// useMemberCaps fetches members + capabilities straight off
// `mero.admin` and reads the caller identity from useDriveWorkspace.
// Both are mocked so each test pins the server responses directly.
// The hook has no other imports - notably it does NOT touch
// constants/config, so this file is insulated from the mero-js
// CAPABILITIES re-export.

const listMembers = vi.fn();
const getCaps = vi.fn();
// Stable mero ref - the effect deps include `mero`; a fresh object
// every render would retrigger the fetch and infinite-loop.
const MERO_STUB = {
  mero: {
    admin: {
      listGroupMembers: listMembers,
      getMemberCapabilities: getCaps,
    },
  },
};
let sseHandler: ((e: SseEventData) => void) | null = null;
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: (_ids: unknown, handler: (e: SseEventData) => void) => {
    sseHandler = handler;
  },
  useMero: () => MERO_STUB,
}));

const identity: { value: string | null } = { value: 'bob' };
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    selfIdentity: identity.value,
    registryContextId: 'registry-ctx',
  }),
}));

function syncEnded(contextId: string, state: string) {
  act(() =>
    sseHandler?.({
      contextId,
      type: 'SyncStatus',
      data: { syncState: { state }, failureCount: 0 },
    }),
  );
}

// A u32 with every bit set - what the hook reports as `caps` for a
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
    expect(result.current.denied).toBe(false);
    expect(getCaps).not.toHaveBeenCalled();
  });

  it(
    'reports a denial once the not-a-member retries are exhausted',
    async () => {
      getCaps.mockRejectedValue(notAMember());
      const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
      await waitFor(() => expect(result.current.error).not.toBeNull(), {
        timeout: 9000,
      });
      expect(getCaps).toHaveBeenCalledTimes(4);
      expect(result.current.denied).toBe(true);
    },
    12000,
  );

  it('does not retry a 500 whose body reads like a refusal', async () => {
    const fault = httpError(500, '{"error":"identity is not a member"}');
    getCaps.mockRejectedValue(fault);
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.error).toBe(fault));
    expect(getCaps).toHaveBeenCalledTimes(1);
    expect(result.current.denied).toBe(false);
  });

  it('does not retry a revoked session that also answers 403', async () => {
    const revoked = new AuthRevokedError('token_revoked', 403, '', '/', new Headers(), '');
    getCaps.mockRejectedValue(revoked);
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.error).toBe(revoked));
    expect(getCaps).toHaveBeenCalledTimes(1);
    expect(result.current.denied).toBe(false);
  });

  it('drops the last caps once core no longer finds the member', async () => {
    getCaps.mockResolvedValue({ capabilities: 5 });
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.caps).toBe(5));
    getCaps.mockRejectedValue(new HTTPError(404, '', '/groups/g1/members/bob/capabilities', new Headers()));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.caps).toBe(0);
  });

  it('keeps the last good caps when a re-read fails for another reason', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getCaps.mockResolvedValue({ capabilities: 5 });
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.caps).toBe(5));
    listMembers.mockRejectedValue(new Error('HTTP 502'));
    act(() => result.current.refetch());
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    await new Promise((settled) => setTimeout(settled, 20)); // let the failed read finish
    expect(result.current.caps).toBe(5);
    expect(result.current.error).toBeNull();
  });

  it(
    'drops to no caps when a re-read is refused as not a member',
    async () => {
      getCaps.mockResolvedValue({ capabilities: 5 });
      const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
      await waitFor(() => expect(result.current.caps).toBe(5));
      getCaps.mockRejectedValue(notAMember());
      act(() => result.current.refetch());
      await waitFor(() => expect(result.current.denied).toBe(true), {
        timeout: 9000,
      });
      expect(result.current.caps).toBe(0);
    },
    12000,
  );

  it('refetch() re-runs the membership probe', async () => {
    getCaps.mockResolvedValue({ capabilities: 1 });
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.caps).toBe(1));
    getCaps.mockResolvedValue({ capabilities: 7 });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.caps).toBe(7));
  });

  // The behaviour core unblocks: an inherited Open-subgroup
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

  // Caps change without a context event, so the registry's sync run is the only tick.
  it('refetches on the registry sync, not on another context ending first', async () => {
    const { result } = renderHook(() => useMemberCaps('ns', 'g1'));
    await waitFor(() => expect(result.current.caps).not.toBeNull());
    const before = listMembers.mock.calls.length;

    syncEnded('docs-ctx', 'waitingForPeers');
    await new Promise((r) => setTimeout(r, 600));
    expect(listMembers.mock.calls.length).toBe(before);

    syncEnded('registry-ctx', 'idle');
    await waitFor(() =>
      expect(listMembers.mock.calls.length).toBe(before + 1),
    );
  });
});
