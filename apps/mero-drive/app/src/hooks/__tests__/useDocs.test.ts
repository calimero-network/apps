import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDocs } from '../useDocs';

// Regression layer for useDocs — the docs facade for a folder. The
// behaviour under test spans: the happy path, the docs-context
// self-heal (a node can be a folder-SUBGROUP member without an owned
// identity in the docs CONTEXT — core's join-via-inheritance is
// subgroup-scoped), the one-attempt heal cap, and error surfacing.
// All dependencies are mocked so each path is driven directly.
const listDocs = vi.fn();
const getFolderContext = vi.fn();
const joinContext = vi.fn();

const docsClientStub = {
  listDocs,
  createDoc: vi.fn(),
  editDoc: vi.fn(),
  getDoc: vi.fn(),
  deleteDoc: vi.fn(),
};

vi.mock('@calimero-network/mero-react', () => ({
  useJoinContext: () => ({ joinContext, loading: false, error: null }),
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    registryClient: { getFolderContext },
  }),
}));
vi.mock('../useSelfIdentity', () => ({
  useSelfIdentity: () => ({ identity: 'me', loading: false, error: null }),
}));
// A client only once a context id has resolved — mirrors the real
// useDocsClient so `refetch` doesn't fire before the context is known.
vi.mock('../useDocsClient', () => ({
  useDocsClient: (ctxId: string | null) => (ctxId ? docsClientStub : null),
}));
vi.mock('../useDocEvents', () => ({
  useDocEvents: () => undefined,
}));

const OWNED_IDENTITY_ERR = 'No owned identity found for this context';

// Mirror the error mero-js actually throws for a JSON-RPC
// FunctionCallError: `new E(code, message, data, type)` — `.message`
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
    getFolderContext.mockResolvedValue('docs-ctx-1');
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
    // list_docs never recovers — the heal must fire exactly once and
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
    getFolderContext.mockRejectedValue(new Error('registry down'));
    const { result } = renderHook(() => useDocs('folder-1'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/registry down/);
    expect(listDocs).not.toHaveBeenCalled();
  });

  it('with no folder selected → empty list, not loading', async () => {
    const { result } = renderHook(() => useDocs(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.list).toEqual([]);
    expect(result.current.contextId).toBeNull();
  });
});
