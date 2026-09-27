import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAppNamespaces } from '../useAppNamespaces';

const list = vi.hoisted(() => vi.fn());
const mero = vi.hoisted(() => ({ mero: { admin: { listNamespacesForApplication: list } } }));
vi.mock('@calimero-network/mero-react', () => ({ useMero: () => mero }));

describe('useAppNamespaces', () => {
  it('is not listed before a read, and is once one succeeds', async () => {
    list.mockResolvedValue([{ namespaceId: 'ns1' }]);
    const { result } = renderHook(() => useAppNamespaces('app'));
    expect(result.current.listed).toBe(false);
    await waitFor(() => expect(result.current.listed).toBe(true));
    expect(result.current.namespaces).toEqual([{ namespaceId: 'ns1' }]);
  });

  it('drops the previous app id’s list and its late answer after a switch', async () => {
    let answerA: (v: { namespaceId: string }[]) => void = () => {};
    list.mockImplementation((appId: string) =>
      appId === 'a'
        ? new Promise((r) => (answerA = r))
        : Promise.resolve([{ namespaceId: 'from-b' }]),
    );
    const { result, rerender } = renderHook(({ id }) => useAppNamespaces(id), {
      initialProps: { id: 'a' },
    });
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.listed).toBe(true));
    await act(async () => answerA([{ namespaceId: 'from-a' }]));
    expect(result.current.namespaces).toEqual([{ namespaceId: 'from-b' }]);
  });

  it('is not listed after a failed read', async () => {
    list.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useAppNamespaces('app'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.listed).toBe(false);
  });
});
