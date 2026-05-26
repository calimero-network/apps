import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMemberDisplayName } from '../useMemberDisplayName';

// Mock mero-react hooks. memberMetadataMock is invoked each render with
// the same args the hook receives so we can both pin the returned state
// and (when needed) assert it was called with `(nsId, identity)`.
const memberMetadataMock = vi.fn();
const setMemberMetadataFn = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: vi.fn(),
  useMemberMetadata: (...args: unknown[]) => memberMetadataMock(...args),
  useSetMemberMetadata: () => ({
    setMemberMetadata: setMemberMetadataFn,
    loading: false,
    error: null,
  }),
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ selfIdentity: 'self-pubkey' }),
}));

describe('useMemberDisplayName', () => {
  beforeEach(() => {
    memberMetadataMock.mockReset();
    setMemberMetadataFn.mockReset();
  });

  it('returns name from MetadataRecord.name', async () => {
    memberMetadataMock.mockReturnValue({
      metadata: { name: 'Alice', data: {}, updatedAt: 0, updatedBy: '' },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() =>
      useMemberDisplayName('ns1', 'alice-key'),
    );
    await waitFor(() => expect(result.current.name).toBe('Alice'));
  });

  it('returns null when no name set', async () => {
    memberMetadataMock.mockReturnValue({
      metadata: { name: null, data: {}, updatedAt: 0, updatedBy: '' },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() =>
      useMemberDisplayName('ns1', 'someone'),
    );
    await waitFor(() => expect(result.current.name).toBeNull());
  });

  it('returns null when metadata is null', async () => {
    memberMetadataMock.mockReturnValue({
      metadata: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() =>
      useMemberDisplayName('ns1', 'someone'),
    );
    await waitFor(() => expect(result.current.name).toBeNull());
  });

  it('setName calls setMemberMetadata and refetches', async () => {
    const refetch = vi.fn();
    memberMetadataMock.mockReturnValue({
      metadata: { name: null, data: {}, updatedAt: 0, updatedBy: '' },
      loading: false,
      error: null,
      refetch,
    });
    setMemberMetadataFn.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useMemberDisplayName('ns1', 'self-pubkey'),
    );
    await act(async () => {
      await result.current.setName('Bob');
    });
    expect(setMemberMetadataFn).toHaveBeenCalledWith('ns1', 'self-pubkey', {
      name: 'Bob',
      data: {},
    });
    expect(refetch).toHaveBeenCalled();
  });

  it('setName trims and rejects empty', async () => {
    memberMetadataMock.mockReturnValue({
      metadata: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() =>
      useMemberDisplayName('ns1', 'self-pubkey'),
    );
    await expect(result.current.setName('   ')).rejects.toThrow();
    expect(setMemberMetadataFn).not.toHaveBeenCalled();
  });

  it('returns loading=true while metadata is loading', () => {
    memberMetadataMock.mockReturnValue({
      metadata: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() =>
      useMemberDisplayName('ns1', 'someone'),
    );
    expect(result.current.loading).toBe(true);
  });

  it('setName refuses when hook is bound to a non-self memberId', async () => {
    // setName is self-only: when the hook is bound to someone else's
    // identity, calling setName must throw rather than silently refetch
    // the wrong member after writing to self.
    memberMetadataMock.mockReturnValue({
      metadata: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    setMemberMetadataFn.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useMemberDisplayName('ns1', 'someone-else'),
    );
    await expect(result.current.setName('Bob')).rejects.toThrow(/self-only/);
    expect(setMemberMetadataFn).not.toHaveBeenCalled();
  });

  it('setName rejects names longer than the max length', async () => {
    memberMetadataMock.mockReturnValue({
      metadata: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() =>
      useMemberDisplayName('ns1', 'self-pubkey'),
    );
    await expect(result.current.setName('x'.repeat(65))).rejects.toThrow(/64/);
    expect(setMemberMetadataFn).not.toHaveBeenCalled();
  });
});
