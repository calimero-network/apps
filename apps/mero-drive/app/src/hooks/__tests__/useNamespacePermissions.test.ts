import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNamespacePermissions } from '../useNamespacePermissions';
import { CAP } from '../../constants/config';
import { adminRequest } from '../../api/adminApi';

vi.mock('../useSelfIdentity', () => ({
  useSelfIdentity: () => ({ identity: 'me', loading: false, error: null }),
}));
vi.mock('../../api/adminApi', () => ({ adminRequest: vi.fn() }));

describe('useNamespacePermissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives canCreateSubgroup from CREATE_GROUP bit', async () => {
    (adminRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      capabilities: CAP.CREATE_GROUP,
    });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canCreateSubgroup).toBe(true);
    expect(result.current.canManageNamespace).toBe(false);
  });

  it('canManageNamespace requires MANAGE_GROUP', async () => {
    (adminRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      capabilities: CAP.MANAGE_GROUP,
    });
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.canManageNamespace).toBe(true));
  });

  it('stays loading and skips fetch when rootGroupId is empty', () => {
    const { result } = renderHook(() => useNamespacePermissions('ns', ''));
    expect(result.current.loading).toBe(true);
    expect(result.current.canCreateSubgroup).toBe(false);
    expect(result.current.canManageNamespace).toBe(false);
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it('exposes error when fetch fails — distinguishes from legitimate zero caps', async () => {
    const boom = new Error('network down');
    (adminRequest as ReturnType<typeof vi.fn>).mockRejectedValue(boom);
    const { result } = renderHook(() => useNamespacePermissions('ns', 'root'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(boom);
    expect(result.current.canManageNamespace).toBe(false);
  });

  it('clears caps synchronously when rootGroupId changes — no stale admin affordances', async () => {
    (adminRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      capabilities: CAP.MANAGE_GROUP,
    });
    const { result, rerender } = renderHook(
      ({ root }: { root: string }) => useNamespacePermissions('ns', root),
      { initialProps: { root: 'root-1' } },
    );
    await waitFor(() => expect(result.current.canManageNamespace).toBe(true));

    (adminRequest as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    rerender({ root: 'root-2' });
    expect(result.current.canManageNamespace).toBe(false);
    expect(result.current.loading).toBe(true);
  });
});
