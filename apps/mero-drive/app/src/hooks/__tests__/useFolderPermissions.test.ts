import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderPermissions } from '../useFolderPermissions';
import { CAP } from '../../constants/config';
import { adminRequest } from '../../api/adminApi';

vi.mock('../useSelfIdentity', () => ({
  useSelfIdentity: () => ({ identity: 'me', loading: false, error: null }),
}));
vi.mock('../../api/adminApi', () => ({ adminRequest: vi.fn() }));

describe('useFolderPermissions', () => {
  beforeEach(() => vi.clearAllMocks());

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
