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
});
