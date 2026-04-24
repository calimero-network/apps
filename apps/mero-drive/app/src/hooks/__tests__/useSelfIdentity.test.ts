import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSelfIdentity, clearIdentityCache } from '../useSelfIdentity';
import { adminRequest } from '../../api/adminApi';

vi.mock('../../api/adminApi', () => ({
  adminRequest: vi.fn(),
}));

describe('useSelfIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('calls admin API for first lookup and caches in localStorage', async () => {
    (adminRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      namespaceId: 'ns-1',
      publicKey: 'pk-1',
    });
    const { result } = renderHook(() => useSelfIdentity('ns-1'));
    await waitFor(() => expect(result.current.identity).toBe('pk-1'));
    expect(adminRequest).toHaveBeenCalledWith('/namespaces/ns-1/identity');
    expect(localStorage.getItem('mero-drive:selfId:ns-1')).toBe('pk-1');
  });

  it('returns cached value without hitting admin', async () => {
    localStorage.setItem('mero-drive:selfId:ns-2', 'pk-2');
    const { result } = renderHook(() => useSelfIdentity('ns-2'));
    await waitFor(() => expect(result.current.identity).toBe('pk-2'));
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it('resets identity to null when namespaceId changes and new value not yet cached', async () => {
    // Prime ns-a in cache; ns-b requires a fetch that never resolves.
    localStorage.setItem('mero-drive:selfId:ns-a', 'pk-a');
    (adminRequest as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );
    const { result, rerender } = renderHook(
      ({ ns }: { ns: string }) => useSelfIdentity(ns),
      { initialProps: { ns: 'ns-a' } },
    );
    await waitFor(() => expect(result.current.identity).toBe('pk-a'));

    rerender({ ns: 'ns-b' });
    // After the switch, the old identity must NOT leak into the new
    // namespace's render with loading:false.
    expect(result.current.identity).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('wraps non-Error throws so error.message is safe to read', async () => {
    (adminRequest as ReturnType<typeof vi.fn>).mockRejectedValue('string-not-error');
    const { result } = renderHook(() => useSelfIdentity('ns-err'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('string-not-error');
  });

  it('clearIdentityCache removes every mero-drive:selfId:* entry', () => {
    localStorage.setItem('mero-drive:selfId:ns-1', 'pk-1');
    localStorage.setItem('mero-drive:selfId:ns-2', 'pk-2');
    localStorage.setItem('unrelated-key', 'keep-me');
    clearIdentityCache();
    expect(localStorage.getItem('mero-drive:selfId:ns-1')).toBeNull();
    expect(localStorage.getItem('mero-drive:selfId:ns-2')).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
  });
});
