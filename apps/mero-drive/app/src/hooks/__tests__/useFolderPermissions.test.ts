import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderPermissions } from '../useFolderPermissions';
import { CAP } from '../../constants/config';
import { adminRequest } from '../../api/adminApi';

// Mutable mock: default state is "identity resolved", but individual
// tests can override via `mockIdentity` to simulate loading or error.
const mockIdentity: { value: { identity: string | null; loading: boolean; error: Error | null } } = {
  value: { identity: 'me', loading: false, error: null },
};
vi.mock('../useSelfIdentity', () => ({
  useSelfIdentity: () => mockIdentity.value,
}));
vi.mock('../../api/adminApi', () => ({ adminRequest: vi.fn() }));

describe('useFolderPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdentity.value = { identity: 'me', loading: false, error: null };
  });

  const render = (caps: number) => {
    (adminRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ capabilities: caps });
    return renderHook(() => useFolderPermissions('ns', 'folder-1'));
  };

  it('READ permits canRead only', async () => {
    const { result } = render(CAP.READ);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it('WRITE permits write, not delete', async () => {
    const { result } = render(CAP.READ | CAP.WRITE);
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.canDelete).toBe(false);
  });

  it('MANAGE_GROUP permits delete + rename + visibility', async () => {
    const { result } = render(CAP.MANAGE_GROUP);
    await waitFor(() => expect(result.current.canDelete).toBe(true));
    expect(result.current.canRename).toBe(true);
    expect(result.current.canManageGroup).toBe(true);
  });

  it('surfaces identity fetch error instead of getting stuck in loading', async () => {
    const identityErr = new Error('identity fetch failed');
    mockIdentity.value = { identity: null, loading: false, error: identityErr };
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(identityErr);
    expect(result.current.canRead).toBe(false);
    // And the caps-fetch never fires — we short-circuited on identity err.
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it('exposes error when fetch fails — distinguishes from legitimate zero caps', async () => {
    const boom = new Error('network down');
    (adminRequest as ReturnType<typeof vi.fn>).mockRejectedValue(boom);
    const { result } = renderHook(() => useFolderPermissions('ns', 'folder-x'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(boom);
    expect(result.current.canRead).toBe(false);
  });

  it('clears caps synchronously when folderId changes — no stale admin affordances', async () => {
    // First render: caller is admin on folder-1.
    (adminRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      capabilities: CAP.MANAGE_GROUP,
    });
    const { result, rerender } = renderHook(
      ({ folder }: { folder: string }) => useFolderPermissions('ns', folder),
      { initialProps: { folder: 'folder-1' } },
    );
    await waitFor(() => expect(result.current.canDelete).toBe(true));

    // Second render: next fetch never resolves. canDelete must flip
    // back to false (loading) rather than linger as true.
    (adminRequest as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    rerender({ folder: 'folder-2' });
    expect(result.current.canDelete).toBe(false);
    expect(result.current.loading).toBe(true);
  });
});
