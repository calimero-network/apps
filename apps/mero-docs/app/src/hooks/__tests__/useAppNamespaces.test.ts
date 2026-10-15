import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAppNamespaces } from '../useAppNamespaces';

const list = vi.hoisted(() => vi.fn());
// The RAW client's admin, `useMero().mero.admin`. On a delegated session its
// `listNamespacesForApplication` is the relay's node-wide route, which an
// account's token cannot pass (403). The hook must never reach it; this spy
// exists to prove it does not.
const rawList = vi.hoisted(() => vi.fn());
// The session-aware admin the hook must use: `useMero().admin`.
const mero = vi.hoisted(() => ({
  mero: {
    admin: { listNamespacesForApplication: rawList },
    getTokenData: () => ({ access_token: 'tok' }),
  },
  admin: { listNamespacesForApplication: list },
  isDelegated: false,
  nodeUrl: 'http://node.test',
}));
vi.mock('@calimero-network/mero-react', () => ({ useMero: () => mero }));

afterEach(() => {
  mero.isDelegated = false;
  list.mockReset();
  rawList.mockReset();
  vi.unstubAllGlobals();
});

// Answers like core: one id-ordered page per request, 100 rows unless asked.
function page(ids: string[], query: URLSearchParams) {
  const offset = Number(query.get('offset') ?? 0);
  const limit = Number(query.get('limit') ?? 100);
  return ids.slice(offset, offset + limit).map((namespaceId) => ({ namespaceId }));
}

/**
 * A node holding `ids`: the session admin reads the first page (no page named,
 * so core's first 100), and the node's own route serves the pages after it.
 * Returns the requests that route saw. `afterRead` runs after every answer.
 */
function nodeHolding(ids: string[], afterRead: () => void = () => {}) {
  const seen: { url: string; auth: string | null }[] = [];
  list.mockImplementation(async (appId: string) => {
    expect(appId).toBe('app');
    const rows = page(ids, new URLSearchParams());
    afterRead();
    return rows;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      seen.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
      const rows = page(ids, url.searchParams);
      afterRead();
      return new Response(JSON.stringify({ data: rows }), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return seen;
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
    const seen = nodeHolding(ids);
    const { result } = renderHook(() => useAppNamespaces('app'));
    await waitFor(() => expect(result.current.listed).toBe(true));
    expect(result.current.namespaces.map((n) => n.namespaceId)).toEqual(ids);
    // The page rides on the route, never on the id segment (mero-js encodes
    // that, and core then reads the query as part of the id), with the
    // session's bearer.
    expect(seen).toEqual([
      { url: 'http://node.test/admin-api/namespaces/for-application/app?offset=100&limit=100', auth: 'Bearer tok' },
      { url: 'http://node.test/admin-api/namespaces/for-application/app?offset=200&limit=100', auth: 'Bearer tok' },
    ]);
  });

  it('lists a row once when a create between two page reads shifts it onto the next page', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `ns${String(i + 100)}`);
    nodeHolding(ids, () => ids.unshift('ns000'));
    const { result } = renderHook(() => useAppNamespaces('app'));
    await waitFor(() => expect(result.current.listed).toBe(true));
    const listed = result.current.namespaces.map((n) => n.namespaceId);
    expect(new Set(listed).size).toBe(listed.length);
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

  it('never reaches the raw client: a node session lists through the session admin', async () => {
    list.mockResolvedValue([{ namespaceId: 'ns1' }]);
    const { result } = renderHook(() => useAppNamespaces('app'));
    await waitFor(() => expect(result.current.listed).toBe(true));
    expect(list).toHaveBeenCalledWith('app');
    expect(rawList).not.toHaveBeenCalled();
  });

  // An account's token holds `namespace:list-own`, not the node-wide listing
  // `GET /admin-api/namespaces/for-application/{appId}` needs: through the raw
  // client that read was a 403 ("Token does not carry the permissions this
  // route requires") and the switcher said "Failed to load workspaces". The
  // account admin answers with the account's own list, filtered on the id
  // exactly, so it is asked once, with the bare id.
  it('on a delegated session lists through admin.listNamespacesForApplication with the bare id, once, and never the raw route', async () => {
    mero.isDelegated = true;
    list.mockResolvedValue([
      { namespaceId: 'ns1', targetApplicationId: 'app' },
      { namespaceId: 'ns2', targetApplicationId: 'app' },
    ]);
    const { result } = renderHook(() => useAppNamespaces('app'));
    await waitFor(() => expect(result.current.listed).toBe(true));
    expect(result.current.namespaces.map((n) => n.namespaceId)).toEqual(['ns1', 'ns2']);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith('app');
    expect(rawList).not.toHaveBeenCalled();
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
