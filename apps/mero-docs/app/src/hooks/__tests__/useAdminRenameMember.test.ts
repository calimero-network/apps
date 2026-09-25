import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useAdminRenameMember,
  MAX_DISPLAY_NAME_LEN,
} from '../useAdminRenameMember';

const setMemberMetadataFn = vi.fn();
const useMemberCapsMock = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: vi.fn(),
  useSetMemberMetadata: () => ({
    setMemberMetadata: setMemberMetadataFn,
    loading: false,
    error: null,
  }),
}));
vi.mock('../useMemberCaps', () => ({
  useMemberCaps: (...a: unknown[]) => useMemberCapsMock(...a),
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ selfIdentity: 'self', rootGroupId: 'root' }),
}));

describe('useAdminRenameMember', () => {
  beforeEach(() => {
    setMemberMetadataFn.mockReset();
    useMemberCapsMock.mockReset();
  });

  it('canRename true when caller is core admin', () => {
    useMemberCapsMock.mockReturnValue({ caps: 0, isAdmin: true, error: null });
    const { result } = renderHook(() => useAdminRenameMember('ns', 'someone'));
    expect(result.current.canRename).toBe(true);
  });

  it('canRename true when caller has CAN_MANAGE_METADATA bit', () => {
    useMemberCapsMock.mockReturnValue({
      caps: 256,
      isAdmin: false,
      error: null,
    }); // 256 = CAN_MANAGE_METADATA
    const { result } = renderHook(() => useAdminRenameMember('ns', 'someone'));
    expect(result.current.canRename).toBe(true);
  });

  it('canRename false otherwise', () => {
    useMemberCapsMock.mockReturnValue({ caps: 37, isAdmin: false, error: null });
    const { result } = renderHook(() => useAdminRenameMember('ns', 'someone'));
    expect(result.current.canRename).toBe(false);
  });

  it('renameTo calls setMemberMetadata for the target member', async () => {
    useMemberCapsMock.mockReturnValue({ caps: 0, isAdmin: true, error: null });
    setMemberMetadataFn.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAdminRenameMember('ns', 'target-id'),
    );
    await act(async () => {
      await result.current.renameTo('Alice');
    });
    expect(setMemberMetadataFn).toHaveBeenCalledWith('ns', 'target-id', {
      name: 'Alice',
      data: {},
    });
  });

  it('renameTo throws when canRename is false', async () => {
    useMemberCapsMock.mockReturnValue({ caps: 37, isAdmin: false, error: null });
    const { result } = renderHook(() =>
      useAdminRenameMember('ns', 'target-id'),
    );
    await expect(result.current.renameTo('Alice')).rejects.toThrow(
      /permission/i,
    );
    expect(setMemberMetadataFn).not.toHaveBeenCalled();
  });

  it('renameTo trims and rejects empty / over-max', async () => {
    useMemberCapsMock.mockReturnValue({ caps: 0, isAdmin: true, error: null });
    const { result } = renderHook(() =>
      useAdminRenameMember('ns', 'target-id'),
    );
    await expect(result.current.renameTo('   ')).rejects.toThrow(/empty/);
    await expect(
      result.current.renameTo('x'.repeat(MAX_DISPLAY_NAME_LEN + 1)),
    ).rejects.toThrow(new RegExp(`${MAX_DISPLAY_NAME_LEN}`));
  });

  it('renameTo refuses to write to self (use useMemberDisplayName)', async () => {
    useMemberCapsMock.mockReturnValue({ caps: 0, isAdmin: true, error: null });
    const { result } = renderHook(() => useAdminRenameMember('ns', 'self'));
    await expect(result.current.renameTo('Me')).rejects.toThrow(/self/);
  });
});
