// Each docs context gets its own fake client, so a test can hold one folder's
// read open, fail it, or fire an event for it alone.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useWorkspaceIndex } from '../useWorkspaceIndex';
import { notifyDocsRefetch } from '../useDocs';

type Folder = {
  id: string;
  alias: string;
  parent_id: string | null;
  color: string | null;
};
type Reg = {
  id: string;
  parent_id: string | null;
  color: string | null;
  context_id: string | null;
};

const NS = 1_000_000;
const listDocs = new Map<string, ReturnType<typeof vi.fn>>();
const joinContext = vi.fn(async (): Promise<unknown> => ({}));
let eventHandler: ((contextId?: string) => void) | null = null;
let eventIds: string[] = [];
const ws: {
  folders: Folder[];
  registryFolders: Reg[] | null;
  selfIdentity: string | null;
} = {
  folders: [],
  registryFolders: null,
  selfIdentity: 'me',
};
const mero = {};

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ mero }),
  useJoinContext: () => ({ joinContext }),
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ws,
}));
vi.mock('../useContextEvents', () => ({
  useContextEvents: (ids: string[], handler: (contextId?: string) => void) => {
    eventIds = ids;
    eventHandler = handler;
  },
}));
vi.mock('@/generated/docs/DocsClient', () => ({
  DocsClient: class {
    listDocs: ReturnType<typeof vi.fn>;
    constructor(_mero: unknown, contextId: string) {
      this.listDocs = listDocs.get(contextId) ?? vi.fn(async () => []);
    }
  },
}));

function doc(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    tags: [],
    archived: false,
    created_at: 1_000 * NS,
    updated_at: 2_000 * NS,
    created_by: 'alice',
    updated_by: 'bob',
    ...over,
  };
}

function workspace(folders: [string, string | null][]) {
  ws.folders = folders.map(([id]) => ({
    id,
    alias: id.toUpperCase(),
    parent_id: null,
    color: null,
  }));
  ws.registryFolders = folders.map(([id, ctx]) => ({
    id,
    parent_id: null,
    color: null,
    context_id: ctx,
  }));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function noIdentityError(): Error {
  const e = new Error('FunctionCallError') as Error & { data?: string };
  e.data = 'No owned identity found for this context';
  return e;
}

beforeEach(() => {
  listDocs.clear();
  joinContext.mockClear();
  eventHandler = null;
  eventIds = [];
  ws.selfIdentity = 'me';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useWorkspaceIndex', () => {
  it('lists every folder with archived docs included, in milliseconds', async () => {
    workspace([
      ['f1', 'c1'],
      ['f2', 'c2'],
    ]);
    listDocs.set(
      'c1',
      vi.fn(async () => [doc('a')]),
    );
    listDocs.set(
      'c2',
      vi.fn(async () => [doc('b', { archived: true, tags: ['q3'] })]),
    );
    const { result } = renderHook(() => useWorkspaceIndex());

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(listDocs.get('c1')).toHaveBeenCalledWith({ include_archived: true });
    const b = result.current.rows.find((r) => r.docId === 'b');
    expect(b).toEqual({
      folderId: 'f2',
      docId: 'b',
      title: 'b',
      tags: ['q3'],
      archived: true,
      createdAt: 1_000,
      updatedAt: 2_000,
      createdBy: 'alice',
      updatedBy: 'bob',
    });
    expect(result.current.folderStatus).toEqual({ f1: 'ready', f2: 'ready' });
    expect(result.current.contextOf('f2')).toBe('c2');
    expect(result.current.folders.map((f) => f.name)).toEqual(['F1', 'F2']);
  });

  it('knows no folders until the workspace folder list has loaded', () => {
    workspace([['f1', 'c1']]);
    ws.registryFolders = null;
    const { result } = renderHook(() => useWorkspaceIndex());
    expect(result.current.folders).toEqual([]);
    expect(result.current.rows).toEqual([]);
  });

  it('reports each folder on its own: loading, syncing, error', async () => {
    workspace([
      ['f1', 'c1'],
      ['f2', null],
      ['f3', 'c3'],
    ]);
    const slow = deferred<unknown[]>();
    listDocs.set(
      'c1',
      vi.fn(() => slow.promise),
    );
    listDocs.set(
      'c3',
      vi.fn(async () => Promise.reject(new Error('boom'))),
    );
    const { result } = renderHook(() => useWorkspaceIndex());

    await waitFor(() => expect(result.current.folderStatus.f3).toBe('error'));
    expect(result.current.folderStatus.f1).toBe('loading');
    expect(result.current.folderStatus.f2).toBe('syncing');
    await act(async () => slow.resolve([doc('a')]));
    expect(result.current.folderStatus.f1).toBe('ready');
  });

  it('joins a folder it has no identity in, syncing meanwhile, then lists it', async () => {
    workspace([['f1', 'c1']]);
    const join = deferred<unknown>();
    joinContext.mockImplementationOnce(() => join.promise);
    listDocs.set(
      'c1',
      vi
        .fn()
        .mockRejectedValueOnce(noIdentityError())
        .mockResolvedValue([doc('a')]),
    );
    const { result } = renderHook(() => useWorkspaceIndex());

    await waitFor(() => expect(result.current.folderStatus.f1).toBe('syncing'));
    expect(joinContext).toHaveBeenCalledWith('c1');
    await act(async () => join.resolve({}));
    await waitFor(() => expect(result.current.folderStatus.f1).toBe('ready'));
    expect(result.current.rows.map((r) => r.docId)).toEqual(['a']);
  });

  it('re-reads only the folder whose context fired, once the burst settles', async () => {
    workspace([
      ['f1', 'c1'],
      ['f2', 'c2'],
    ]);
    listDocs.set(
      'c1',
      vi.fn(async () => [doc('a')]),
    );
    listDocs.set(
      'c2',
      vi.fn(async () => [doc('b')]),
    );
    const { result } = renderHook(() => useWorkspaceIndex());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(eventIds).toEqual(['c1', 'c2']);

    vi.useFakeTimers();
    listDocs.get('c2')!.mockResolvedValue([doc('b'), doc('c')]);
    act(() => {
      eventHandler?.('c2');
      eventHandler?.('c2');
    });
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(listDocs.get('c1')).toHaveBeenCalledTimes(1);
    expect(listDocs.get('c2')).toHaveBeenCalledTimes(2);
  });

  it('re-reads a folder at once when this app changes one of its docs', async () => {
    workspace([['f1', 'c1']]);
    listDocs.set(
      'c1',
      vi.fn(async () => [doc('a')]),
    );
    const { result } = renderHook(() => useWorkspaceIndex());
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    listDocs.get('c1')!.mockResolvedValue([doc('a'), doc('b')]);
    act(() => notifyDocsRefetch('c1'));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
  });

  it('drops a read that lands after the workspace changed', async () => {
    workspace([['f1', 'c1']]);
    const old = deferred<unknown[]>();
    listDocs.set(
      'c1',
      vi.fn(() => old.promise),
    );
    listDocs.set(
      'c9',
      vi.fn(async () => [doc('z')]),
    );
    const { result, rerender } = renderHook(() => useWorkspaceIndex());

    workspace([['f9', 'c9']]);
    rerender();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    await act(async () => old.resolve([doc('stale')]));
    expect(result.current.rows.map((r) => r.docId)).toEqual(['z']);
  });

  it('never lets a late read for an old binding overwrite the new one', async () => {
    workspace([['f1', 'c1']]);
    const old = deferred<unknown[]>();
    listDocs.set(
      'c1',
      vi.fn(() => old.promise),
    );
    listDocs.set(
      'c2',
      vi.fn(async () => [doc('fresh')]),
    );
    const { result, rerender } = renderHook(() => useWorkspaceIndex());

    workspace([['f1', 'c2']]);
    rerender();
    await waitFor(() => expect(result.current.folderStatus.f1).toBe('ready'));
    await act(async () => old.resolve([doc('stale')]));
    expect(result.current.folderStatus.f1).toBe('ready');
    expect(result.current.rows.map((r) => r.docId)).toEqual(['fresh']);
  });

  it('keeps the last good list when a re-read fails', async () => {
    workspace([['f1', 'c1']]);
    listDocs.set(
      'c1',
      vi.fn(async () => [doc('a')]),
    );
    const { result } = renderHook(() => useWorkspaceIndex());
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    listDocs.get('c1')!.mockRejectedValue(new Error('node down'));
    await act(async () => result.current.refetchFolder('f1'));
    await waitFor(() => expect(listDocs.get('c1')).toHaveBeenCalledTimes(2));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.folderStatus.f1).toBe('ready');
  });

  it('retries a failed folder, joining again if it still has no identity', async () => {
    workspace([['f1', 'c1']]);
    listDocs.set('c1', vi.fn().mockRejectedValue(noIdentityError()));
    const { result } = renderHook(() => useWorkspaceIndex());
    await waitFor(() => expect(result.current.folderStatus.f1).toBe('error'));
    expect(joinContext).toHaveBeenCalledTimes(1);

    listDocs
      .get('c1')!
      .mockReset()
      .mockRejectedValueOnce(noIdentityError())
      .mockResolvedValue([doc('a')]);
    await act(async () => result.current.refetchFolder('f1'));
    await waitFor(() => expect(result.current.folderStatus.f1).toBe('ready'));
    expect(joinContext).toHaveBeenCalledTimes(2);
  });
});
