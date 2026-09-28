import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAppNamespaces } from '../useAppNamespaces';

const list = vi.hoisted(() => vi.fn());
const mero = vi.hoisted(() => ({ mero: { admin: { listNamespacesForApplication: list } } }));
vi.mock('@calimero-network/mero-react', () => ({ useMero: () => mero }));

// Answers like core: one id-ordered page per request, 100 rows unless asked.
function nodeHolding(ids: string[]) {
  return async (appIdAndQuery: string) => {
    const query = new URLSearchParams(appIdAndQuery.split('?')[1] ?? '');
    const offset = Number(query.get('offset') ?? 0);
    const limit = Number(query.get('limit') ?? 100);
    return ids.slice(offset, offset + limit).map((namespaceId) => ({ namespaceId }));
  };
}

describe('useAppNamespaces', () => {
  it('is not listed before a read, and is once one succeeds', async () => {
    list.mockResolvedValue([{ namespaceId: 'ns1' }]);
    const { result } = renderHook(() => useAppNamespaces('app'));
    expect(result.current.listed).toBe(false);
    await waitFor(() => expect(result.current.listed).toBe(true));
    expect(result.current.namespaces).toEqual([{ namespaceId: 'ns1' }]);
  });

  it('reads every page, so a workspace past the node’s first 100 is listed', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `ns${String(i).padStart(3, '0')}`);
    list.mockImplementation(nodeHolding(ids));
    const { result } = renderHook(() => useAppNamespaces('app'));
    await waitFor(() => expect(result.current.listed).toBe(true));
    expect(result.current.namespaces.map((n) => n.namespaceId)).toEqual(ids);
  });

  it('lists a row once when a create between two page reads shifts it onto the next page', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `ns${String(i + 100)}`);
    const serve = nodeHolding(ids);
    list.mockImplementation(async (appIdAndQuery: string) => {
      const page = await serve(appIdAndQuery);
      ids.unshift('ns000');
      return page;
    });
    const { result } = renderHook(() => useAppNamespaces('app'));
    await waitFor(() => expect(result.current.listed).toBe(true));
    const listed = result.current.namespaces.map((n) => n.namespaceId);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('drops the previous app id’s list and its late answer after a switch', async () => {
    let answerA: (v: { namespaceId: string }[]) => void = () => {};
    list.mockImplementation((appId: string) =>
      appId.startsWith('a?')
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

  it('keeps the last good list, and stays listed, when a later read fails', async () => {
    list.mockResolvedValueOnce([{ namespaceId: 'ns1' }]);
    const { result } = renderHook(() => useAppNamespaces('app'));
    await waitFor(() => expect(result.current.listed).toBe(true));
    list.mockRejectedValueOnce(new Error('down'));
    await act(() => result.current.refetch());
    expect(result.current.error).not.toBeNull();
    expect(result.current.listed).toBe(true);
    expect(result.current.namespaces).toEqual([{ namespaceId: 'ns1' }]);
  });
});
