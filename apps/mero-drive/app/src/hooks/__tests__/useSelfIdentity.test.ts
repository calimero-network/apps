import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSelfIdentity } from '../useSelfIdentity';

vi.mock('../../api/adminApi', () => ({
  adminRequest: vi.fn(),
}));
import { adminRequest } from '../../api/adminApi';

describe('useSelfIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('calls admin API for first lookup and caches in localStorage', async () => {
    (adminRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ identity: 'pk-1' });
    const { result } = renderHook(() => useSelfIdentity('ns-1'));
    await waitFor(() => expect(result.current.identity).toBe('pk-1'));
    expect(adminRequest).toHaveBeenCalledWith('/namespaces/ns-1/self-identity');
    expect(localStorage.getItem('mero-drive:selfId:ns-1')).toBe('pk-1');
  });

  it('returns cached value without hitting admin', async () => {
    localStorage.setItem('mero-drive:selfId:ns-2', 'pk-2');
    const { result } = renderHook(() => useSelfIdentity('ns-2'));
    await waitFor(() => expect(result.current.identity).toBe('pk-2'));
    expect(adminRequest).not.toHaveBeenCalled();
  });
});
