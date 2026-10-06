import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { subscribeDocsRefetch, useDocs } from '../useDocs';

// Regression layer for useDocs - the docs facade for a folder. The
// behaviour under test spans: the happy path, the docs-context
// self-heal (a node can be a folder-SUBGROUP member without an owned
// identity in the docs CONTEXT - core's join-via-inheritance is
// subgroup-scoped), the one-attempt heal cap, and error surfacing.
// All dependencies are mocked so each path is driven directly.
const listDocs = vi.fn();
const subgroupContext = vi.fn();
const joinContext = vi.fn();

const docsClientStub = {
  listDocs,
  createDoc: vi.fn(),
  editDoc: vi.fn(),
  getDoc: vi.fn(),
  deleteDoc: vi.fn(),
  addTag: vi.fn(),
  removeTag: vi.fn(),
  archiveDoc: vi.fn(),
  unarchiveDoc: vi.fn(),
};
// Per-context clients for tests that switch folders; others share the stub.
const clientsByContext = new Map<string, { listDocs: typeof listDocs }>();
const workspace = { selfIdentity: 'me' as string | null };
// A folder's docs context is the one context core lists in its subgroup;
// `subgroupContext` names it per folder. Stable, like the session's admin.
const meroStub = {
  admin: {
    listGroupContexts: async (folderId: string) => {
      const contextId = await subgroupContext({ folder_id: folderId });
      return contextId ? [{ contextId }] : [];
    },
  },
};

vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: vi.fn(),
  useJoinContext: () => ({ joinContext, loading: false, error: null }),
  useMero: () => meroStub,
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    selfIdentity: workspace.selfIdentity,
  }),
}));
// A client only once a context id has resolved - mirrors the real
// useDocsClient so `refetch` doesn't fire before the context is known.
vi.mock('../useDocsClient', () => ({
  useDocsClient: (ctxId: string | null, identity: string | null) =>
    ctxId && identity ? (clientsByContext.get(ctxId) ?? docsClientStub) : null,
}));
vi.mock('../useDocEvents', () => ({
  useDocEvents: () => undefined,
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const OWNED_IDENTITY_ERR = 'No owned identity found for this context';

// Mirror the error mero-js actually throws for a JSON-RPC
// FunctionCallError: `new E(code, message, data, type)` - `.message`
// is the error TYPE ("FunctionCallError"), and the human-readable
// string lives in `.data`. A predicate that only scans `.message`
// would miss it (this is the bug this shape regression-guards).
function rpcFunctionCallError(data: string): Error {
  const e = new Error('FunctionCallError') as Error & {
    data?: string;
    type?: string;
  };
  e.data = data;
  e.type = 'FunctionCallError';
  return e;
}

describe('useDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientsByContext.clear();
    workspace.selfIdentity = 'me';
    subgroupContext.mockResolvedValue('docs-ctx-1');
    listDocs.mockResolvedValue([]);
    joinContext.mockResolvedValue({});
  });

  it('lists the folder docs, most-recent first', async () => {
    listDocs.mockResolvedValue([
      { id: 'a', title: 'Older', updated_at: 2 },
      { id: 'b', title: 'Newer', updated_at: 5 },
    ]);
    const { result } = renderHook(() => useDocs('folder-1'));
    await waitFor(() => expect(result.current.list).toHaveLength(2));
    expect(result.current.list[0].id).toBe('b'); // updated_at desc
    expect(result.current.error).toBeNull();
  });

  it('joins the docs context and retries when list_docs reports no owned identity', async () => {
    listDocs
      .mockRejectedValueOnce(rpcFunctionCallError(OWNED_IDENTITY_ERR))
      .mockResolvedValue([{ id: 'd1', title: 'Alpha', updated_at: 1 }]);

    const { result } = renderHook(() => useDocs('folder-1'));

    await waitFor(() => expect(result.current.list).toHaveLength(1));
    expect(joinContext).toHaveBeenCalledWith('docs-ctx-1');
    expect(result.current.error).toBeNull();
  });

  it('caps the self-heal at one joinContext attempt per context', async () => {
    // list_docs never recovers - the heal must fire exactly once and
    // then surface the error rather than looping joinContext forever.
    listDocs.mockRejectedValue(rpcFunctionCallError(OWNED_IDENTITY_ERR));
    const { result } = renderHook(() => useDocs('folder-1'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(joinContext).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-identity error without joining the context', async () => {
    listDocs.mockRejectedValue(new Error('docs service unavailable'));
    const { result } = renderHook(() => useDocs('folder-1'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(joinContext).not.toHaveBeenCalled();
  });

  it('surfaces a docs-context resolution failure', async () => {
    subgroupContext.mockRejectedValue(new Error('core down'));
    const { result } = renderHook(() => useDocs('folder-1'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/core down/);
    expect(listDocs).not.toHaveBeenCalled();
  });

  it('a refetch asked for mid-read settles only on a read that began after it', async () => {
    const first = deferred<{ id: string; title: string; updated_at: number }[]>();
    const second = deferred<{ id: string; title: string; updated_at: number }[]>();
    listDocs.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useDocs('folder-1'));
    await waitFor(() => expect(listDocs).toHaveBeenCalledTimes(1));
    let settled = false;
    const asked = result.current.refetch().then(() => (settled = true));
    await act(async () => first.resolve([{ id: 'old', title: 'Old', updated_at: 1 }]));
    expect(settled).toBe(false);
    await waitFor(() => expect(listDocs).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve([
        { id: 'old', title: 'Old', updated_at: 1 },
        { id: 'new', title: 'New', updated_at: 2 },
      ]);
      await asked;
    });
    expect(result.current.list.map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('shares one context join between instances that both lack an identity', async () => {
    const join = deferred<object>();
    joinContext.mockReturnValue(join.promise);
    listDocs
      .mockRejectedValueOnce(rpcFunctionCallError(OWNED_IDENTITY_ERR))
      .mockRejectedValueOnce(rpcFunctionCallError(OWNED_IDENTITY_ERR))
      .mockResolvedValue([{ id: 'd1', title: 'Alpha', updated_at: 1 }]);
    const { result: first } = renderHook(() => useDocs('folder-1'));
    const { result: second } = renderHook(() => useDocs('folder-1'));
    await waitFor(() => expect(listDocs).toHaveBeenCalledTimes(2));
    await act(async () => join.resolve({}));
    await waitFor(() => expect(first.current.list).toHaveLength(1));
    await waitFor(() => expect(second.current.list).toHaveLength(1));
    expect(joinContext).toHaveBeenCalledTimes(1);
  });

  it('with no folder selected → empty list, not loading', async () => {
    const { result } = renderHook(() => useDocs(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.list).toEqual([]);
    expect(result.current.contextId).toBeNull();
  });

  describe('listed', () => {
    it('is true once a listDocs call has actually succeeded', async () => {
      const { result } = renderHook(() => useDocs('folder-1'));
      expect(result.current.listed).toBe(false);
      await waitFor(() => expect(result.current.listed).toBe(true));
    });

    it('is true for a folder with no docs binding at all', async () => {
      subgroupContext.mockResolvedValue(null);
      const { result } = renderHook(() => useDocs('folder-1'));
      await waitFor(() => expect(result.current.listed).toBe(true));
      expect(listDocs).not.toHaveBeenCalled();
    });

    it('stays false when listDocs fails, so a caller never reads the empty list as final', async () => {
      listDocs.mockRejectedValue(new Error('docs service unavailable'));
      const { result } = renderHook(() => useDocs('folder-1'));
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.listed).toBe(false);
    });

    it('is false while a bound folder has no client yet (no identity)', async () => {
      workspace.selfIdentity = null;
      const { result } = renderHook(() => useDocs('folder-1'));
      await waitFor(() => expect(result.current.contextId).toBe('docs-ctx-1'));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.listed).toBe(false);
    });

    it('lists a newly selected folder even while the previous read is in flight', async () => {
      const slow = deferred<{ id: string; title: string; updated_at: number }[]>();
      clientsByContext.set('ctx-a', { listDocs: vi.fn(() => slow.promise) });
      clientsByContext.set('ctx-b', {
        listDocs: vi.fn().mockResolvedValue([{ id: 'b1', title: 'B', updated_at: 1 }]),
      });
      subgroupContext.mockImplementation(({ folder_id }: { folder_id: string }) =>
        Promise.resolve(folder_id === 'a' ? 'ctx-a' : 'ctx-b'),
      );
      const { result, rerender } = renderHook(({ f }) => useDocs(f), {
        initialProps: { f: 'a' },
      });
      await waitFor(() => expect(result.current.contextId).toBe('ctx-a'));
      rerender({ f: 'b' });
      await waitFor(() => expect(result.current.listed).toBe(true));
      expect(result.current.list.map((d) => d.id)).toEqual(['b1']);
      // The first folder's late answer must not overwrite the current one.
      await act(async () => slow.resolve([{ id: 'a1', title: 'A', updated_at: 1 }]));
      expect(result.current.list.map((d) => d.id)).toEqual(['b1']);
    });

    it('re-lists a folder revisited through an unbound one', async () => {
      clientsByContext.set('ctx-a', {
        listDocs: vi.fn().mockResolvedValue([{ id: 'a1', title: 'A', updated_at: 1 }]),
      });
      subgroupContext.mockImplementation(({ folder_id }: { folder_id: string }) =>
        Promise.resolve(folder_id === 'a' ? 'ctx-a' : null),
      );
      const { result, rerender } = renderHook(({ f }) => useDocs(f), {
        initialProps: { f: 'a' },
      });
      await waitFor(() => expect(result.current.list).toHaveLength(1));
      rerender({ f: 'unbound' });
      await waitFor(() => expect(result.current.listed).toBe(true));
      expect(result.current.list).toEqual([]);
      rerender({ f: 'a' });
      await waitFor(() => expect(result.current.listed).toBe(true));
      expect(result.current.list.map((d) => d.id)).toEqual(['a1']);
    });

    it('re-reads the docs context when retried after that read failed', async () => {
      subgroupContext.mockRejectedValueOnce(new Error('core down'));
      const { result } = renderHook(() => useDocs('folder-1'));
      await waitFor(() => expect(result.current.error).not.toBeNull());
      await result.current.refetch();
      await waitFor(() => expect(result.current.listed).toBe(true));
      expect(subgroupContext).toHaveBeenCalledTimes(2);
    });

    it('stays false when the docs-context resolution itself fails', async () => {
      subgroupContext.mockRejectedValue(new Error('core down'));
      const { result } = renderHook(() => useDocs('folder-1'));
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.listed).toBe(false);
    });
  });

  it('passes includeArchived through to listDocs', async () => {
    const { result } = renderHook(() => useDocs('folder-1', { includeArchived: true }));
    await waitFor(() => expect(result.current.listed).toBe(true));
    expect(listDocs).toHaveBeenCalledWith({ include_archived: true });
  });

  it('tags and untags a doc, then has every list of the folder re-read', async () => {
    const { result } = renderHook(() => useDocs('folder-1'));
    await waitFor(() => expect(result.current.contextId).toBe('docs-ctx-1'));
    const reread = vi.fn();
    const off = subscribeDocsRefetch('docs-ctx-1', reread);
    await act(() => result.current.addTag('d1', 'q3'));
    await act(() => result.current.removeTag('d1', 'plan'));
    off();
    expect(docsClientStub.addTag).toHaveBeenCalledWith({ id: 'd1', tag: 'q3' });
    expect(docsClientStub.removeTag).toHaveBeenCalledWith({
      id: 'd1',
      tag: 'plan',
    });
    expect(reread).toHaveBeenCalledTimes(2);
  });

  it('archives and unarchives a doc, then has every list of the folder re-read', async () => {
    const { result } = renderHook(() => useDocs('folder-1'));
    await waitFor(() => expect(result.current.contextId).toBe('docs-ctx-1'));
    const reread = vi.fn();
    const off = subscribeDocsRefetch('docs-ctx-1', reread);
    await act(() => result.current.archive('d1'));
    await act(() => result.current.unarchive('d1'));
    off();
    expect(docsClientStub.archiveDoc).toHaveBeenCalledWith({ id: 'd1' });
    expect(docsClientStub.unarchiveDoc).toHaveBeenCalledWith({ id: 'd1' });
    expect(reread).toHaveBeenCalledTimes(2);
  });
});
