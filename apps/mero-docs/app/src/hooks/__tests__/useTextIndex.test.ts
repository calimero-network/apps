// Each docs context gets its own fake getDocument, so a test can hold reads
// open, count them, fail one, or fire a doc event for one context.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { BackendBlock } from '@/lib/rich/blocknote';
import type { FolderIndexStatus } from '../useWorkspaceIndex';
import type { FolderInfo, IndexRow } from '@/lib/workspaceIndex/types';
import { DocsClient } from '@/generated/docs/DocsClient';
import { TEXT_INDEX_CONCURRENCY, useTextIndex } from '../useTextIndex';

type Event = { contextId: string; type: string; data: unknown };

const getDocument =
  vi.fn<(contextId: string, doc: string) => Promise<BackendBlock[]>>();
const getDoc =
  vi.fn<(contextId: string, id: string) => Promise<{ updated_at: number }>>();
const getBlockDelta =
  vi.fn<
    (contextId: string, doc: string, block: string) => Promise<BackendBlock['spans']>
  >();
let subscribed: { ids: string[]; handler: (e: Event) => void } | null = null;
// A new session per test: the text cache is per mero client.
let mero = {};

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ mero }),
  useSubscription: (ids: string[], handler: (e: Event) => void) => {
    subscribed = { ids, handler };
  },
}));
vi.mock('@/generated/docs/DocsClient', () => ({
  DocsClient: class {
    constructor(
      _mero: unknown,
      private contextId: string,
    ) {}
    getDocument({ doc }: { doc: string }) {
      return getDocument(this.contextId, doc);
    }
    getDoc({ id }: { id: string }) {
      return getDoc(this.contextId, id);
    }
    getBlockDelta({ doc, block }: { doc: string; block: string }) {
      return getBlockDelta(this.contextId, doc, block);
    }
  },
}));

function row(
  folderId: string,
  docId: string,
  archived = false,
  updatedAt = 0,
): IndexRow {
  return {
    folderId,
    docId,
    title: docId,
    tags: [],
    archived,
    createdAt: 0,
    updatedAt,
    createdBy: 'a',
    updatedBy: 'a',
  };
}

function blocks(text: string): BackendBlock[] {
  return [
    {
      id: 'b1',
      kind: 'paragraph',
      depth: 0,
      attrs: {},
      spans: [{ text }], // the node leaves `attributes` out of a plain span
    },
  ];
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

type Input = {
  rows: IndexRow[];
  folders: FolderInfo[];
  folderStatus: Record<string, FolderIndexStatus>;
  contextOf: (folderId: string) => string | undefined;
  clientOf: (folderId: string) => DocsClient | undefined;
};

function input(
  rows: IndexRow[],
  status: Record<string, FolderIndexStatus>,
): Input {
  return {
    rows,
    folders: Object.keys(status).map((id) => ({ id, name: id })),
    folderStatus: status,
    contextOf: (folderId) => (status[folderId] ? `c-${folderId}` : undefined),
    clientOf: (folderId) =>
      status[folderId]
        ? new DocsClient(mero as never, `c-${folderId}`)
        : undefined,
  };
}

// Lets queued reads start, resolved reads land, and a publish go out.
async function settle(ms = 250) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function textOf(
  result: { current: ReturnType<typeof useTextIndex> },
  key: string,
) {
  return result.current.texts.get(key)?.blocks[0]?.text;
}

beforeEach(() => {
  vi.useFakeTimers();
  mero = {};
  getDocument.mockReset();
  getDoc.mockReset();
  getDoc.mockRejectedValue(new Error('no version'));
  getBlockDelta.mockReset();
  subscribed = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTextIndex', () => {
  it('reads every listed doc with at most 3 in flight, archived ones too', async () => {
    let inFlight = 0;
    let most = 0;
    const open: { doc: string; done: () => void }[] = [];
    getDocument.mockImplementation((_ctx, doc) => {
      inFlight++;
      most = Math.max(most, inFlight);
      const d = deferred<BackendBlock[]>();
      open.push({
        doc,
        done: () => {
          inFlight--;
          d.resolve(blocks(`text of ${doc}`));
        },
      });
      return d.promise;
    });
    const rows = [
      ...['a', 'b', 'c', 'd'].map((d) => row('f1', d)),
      ...['e', 'f', 'g'].map((d) => row('f2', d)),
      row('f2', 'old', true),
    ];
    const { result } = renderHook(() =>
      useTextIndex(input(rows, { f1: 'ready', f2: 'ready' })),
    );

    await settle();
    expect(open).toHaveLength(TEXT_INDEX_CONCURRENCY);
    expect(result.current).toMatchObject({ foldersDone: 0, foldersTotal: 2 });
    while (open.length) {
      open.shift()!.done();
      await settle();
    }

    expect(most).toBe(TEXT_INDEX_CONCURRENCY);
    expect(getDocument).toHaveBeenCalledTimes(8);
    expect(textOf(result, 'f2/old')).toBe('text of old');
    expect(result.current.texts.size).toBe(8);
    expect(textOf(result, 'f2/g')).toBe('text of g');
    expect(result.current).toMatchObject({
      foldersDone: 2,
      foldersTotal: 2,
      pending: [],
    });
  });

  it('counts a folder done only once its list is read and every doc tried', async () => {
    const hold = deferred<BackendBlock[]>();
    getDocument.mockImplementation((_ctx, doc) =>
      doc === 'slow' ? hold.promise : Promise.resolve(blocks(doc)),
    );
    const { result } = renderHook(() =>
      useTextIndex(
        input([row('f1', 'a'), row('f2', 'slow')], {
          f1: 'ready',
          f2: 'ready',
          f3: 'loading',
          f4: 'syncing',
          f5: 'error',
        }),
      ),
    );
    await settle();
    // A syncing or failed folder is named in the warning, not in the progress.
    expect(result.current).toMatchObject({
      foldersDone: 1,
      foldersTotal: 3,
      pending: ['f2', 'f3'],
    });
    hold.resolve(blocks('slow'));
    await settle();
    expect(result.current.pending).toEqual(['f3']);
  });

  it('re-reads only the doc a body event names, once the burst settles', async () => {
    getDocument.mockImplementation((_ctx, doc) =>
      Promise.resolve(blocks(`v1 ${doc}`)),
    );
    const { result } = renderHook(() =>
      useTextIndex(input([row('f1', 'a'), row('f1', 'b')], { f1: 'ready' })),
    );
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(subscribed?.ids).toEqual(['c-f1']);

    getDocument.mockImplementation((_ctx, doc) =>
      Promise.resolve(blocks(`v2 ${doc}`)),
    );
    act(() => {
      for (let i = 0; i < 3; i++) {
        subscribed!.handler({
          contextId: 'c-f1',
          type: 'StateMutation',
          data: { BlockChanged: { doc: 'a', block: 'b1' } },
        });
      }
      // Titles live in the list, not the text index.
      subscribed!.handler({
        contextId: 'c-f1',
        type: 'StateMutation',
        data: { TitleChanged: { doc: 'b' } },
      });
    });
    await settle(1_500);

    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(getDocument).toHaveBeenLastCalledWith('c-f1', 'a');
    expect(textOf(result, 'f1/a')).toBe('v2 a');
    expect(textOf(result, 'f1/b')).toBe('v1 b');
  });

  describe('text events', () => {
    const event = (kind: string, doc: string, block = 'b1') =>
      subscribed!.handler({
        contextId: 'c-f1',
        type: 'StateMutation',
        data: { [kind]: { doc, block } },
      });

    async function loaded() {
      getDocument.mockImplementation((_ctx, doc) =>
        Promise.resolve(blocks(`v1 ${doc}`)),
      );
      const view = renderHook(() =>
        useTextIndex(input([row('f1', 'a')], { f1: 'ready' })),
      );
      await settle();
      getDocument.mockClear();
      return view;
    }

    it('reads only the changed block, once the burst settles', async () => {
      const { result } = await loaded();
      getBlockDelta.mockResolvedValue([{ text: 'v2 a' }]);

      act(() => {
        event('TextChanged', 'a');
        event('MarkApplied', 'a');
        event('TextChanged', 'a');
      });
      await settle(1_500);

      expect(getBlockDelta.mock.calls).toEqual([['c-f1', 'a', 'b1']]);
      expect(getDocument).not.toHaveBeenCalled();
      expect(textOf(result, 'f1/a')).toBe('v2 a');
    });

    it('reads the whole doc when a structural event joins the burst', async () => {
      const { result } = await loaded();
      getDocument.mockResolvedValue(blocks('v2 a'));

      act(() => {
        event('TextChanged', 'a');
        event('BlockInserted', 'a', 'b2');
      });
      await settle(1_500);

      expect(getDocument).toHaveBeenCalledTimes(1);
      expect(getBlockDelta).not.toHaveBeenCalled();
      expect(textOf(result, 'f1/a')).toBe('v2 a');
    });

    it('reads the whole doc for a block it does not hold', async () => {
      await loaded();
      getDocument.mockResolvedValue(blocks('v2 a'));

      act(() => event('TextChanged', 'a', 'b9'));
      await settle(1_500);

      expect(getDocument).toHaveBeenCalledTimes(1);
      expect(getBlockDelta).not.toHaveBeenCalled();
    });

    it('reads the whole doc when the block read fails', async () => {
      const { result } = await loaded();
      getBlockDelta.mockRejectedValue(new Error('gone'));
      getDocument.mockResolvedValue(blocks('v2 a'));

      act(() => event('TextChanged', 'a'));
      await settle(1_500);

      expect(getDocument).toHaveBeenCalledTimes(1);
      expect(textOf(result, 'f1/a')).toBe('v2 a');
    });
  });

  it('reads a doc again when an event lands while it is being read', async () => {
    const first = deferred<BackendBlock[]>();
    getDocument.mockImplementationOnce(() => first.promise);
    getBlockDelta.mockResolvedValue([{ text: 'fresh' }]);
    const { result } = renderHook(() =>
      useTextIndex(input([row('f1', 'a')], { f1: 'ready' })),
    );
    await settle();
    act(() =>
      subscribed!.handler({
        contextId: 'c-f1',
        type: 'StateMutation',
        data: { TextChanged: { doc: 'a', block: 'b1' } },
      }),
    );
    await settle(1_500);
    first.resolve(blocks('stale'));
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(getBlockDelta).toHaveBeenCalledTimes(1);
    expect(textOf(result, 'f1/a')).toBe('fresh');
  });

  it('keeps a read that a list refresh lands on top of', async () => {
    const held = deferred<BackendBlock[]>();
    getDocument.mockImplementationOnce(() => held.promise);
    const { result, rerender } = renderHook(
      ({ rows }) => useTextIndex(input(rows, { f1: 'ready' })),
      { initialProps: { rows: [row('f1', 'a')] } },
    );
    await settle();
    rerender({ rows: [row('f1', 'a')] });
    held.resolve(blocks('landed'));
    await settle();
    expect(textOf(result, 'f1/a')).toBe('landed');
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it('drops a doc that leaves the list, and keeps one that is archived', async () => {
    getDocument.mockImplementation((_ctx, doc) => Promise.resolve(blocks(doc)));
    const { result, rerender } = renderHook(
      ({ rows }) => useTextIndex(input(rows, { f1: 'ready' })),
      {
        initialProps: {
          rows: [row('f1', 'a'), row('f1', 'b'), row('f1', 'c')],
        },
      },
    );
    await settle();
    expect([...result.current.texts.keys()]).toEqual(['f1/a', 'f1/b', 'f1/c']);

    rerender({ rows: [row('f1', 'a'), row('f1', 'c', true)] });
    await settle();
    expect([...result.current.texts.keys()]).toEqual(['f1/a', 'f1/c']);
    expect(getDocument).toHaveBeenCalledTimes(3);
  });

  it('keeps a failed doc and its folder unsearched until a retry reads it', async () => {
    getDocument.mockRejectedValueOnce(new Error('offline'));
    getDocument.mockImplementation((_ctx, doc) => Promise.resolve(blocks(doc)));
    const { result, rerender } = renderHook(
      ({ rows }) => useTextIndex(input(rows, { f1: 'ready', f2: 'ready' })),
      { initialProps: { rows: [row('f1', 'a'), row('f2', 'z')] } },
    );
    await settle();
    expect([...result.current.texts.keys()]).toEqual(['f2/z']);
    expect(result.current).toMatchObject({
      foldersDone: 1,
      foldersTotal: 2,
      pending: ['f1'],
      failed: ['f1'],
    });

    rerender({ rows: [row('f1', 'a'), row('f1', 'b'), row('f2', 'z')] });
    await settle();
    expect([...result.current.texts.keys()].sort()).toEqual([
      'f1/a',
      'f1/b',
      'f2/z',
    ]);
    expect(result.current).toMatchObject({
      foldersDone: 2,
      pending: [],
      failed: [],
    });
  });

  it('re-reads a doc the list says changed since it was read, with no event', async () => {
    getDocument.mockImplementation((_ctx, doc) =>
      Promise.resolve(blocks(`v1 ${doc}`)),
    );
    const { result, rerender } = renderHook(
      ({ rows }) => useTextIndex(input(rows, { f1: 'ready' })),
      {
        initialProps: {
          rows: [row('f1', 'a', false, 5), row('f1', 'b', false, 5)],
        },
      },
    );
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(2);

    getDocument.mockImplementation((_ctx, doc) =>
      Promise.resolve(blocks(`v2 ${doc}`)),
    );
    rerender({ rows: [row('f1', 'a', false, 9), row('f1', 'b', false, 5)] });
    await settle();
    rerender({ rows: [row('f1', 'a', false, 9), row('f1', 'b', false, 5)] });
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(getDocument).toHaveBeenLastCalledWith('c-f1', 'a');
    expect(textOf(result, 'f1/a')).toBe('v2 a');
  });

  it('reads again when the list moves on while a read is in flight', async () => {
    const held = deferred<BackendBlock[]>();
    getDocument.mockImplementationOnce(() => held.promise);
    getDocument.mockImplementation(() => Promise.resolve(blocks('newer')));
    const { result, rerender } = renderHook(
      ({ rows }) => useTextIndex(input(rows, { f1: 'ready' })),
      { initialProps: { rows: [row('f1', 'a', false, 1)] } },
    );
    await settle();
    rerender({ rows: [row('f1', 'a', false, 2)] });
    held.resolve(blocks('older'));
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(textOf(result, 'f1/a')).toBe('newer');
  });

  it('drops the old workspace work: a late read never lands after a switch', async () => {
    const late = deferred<BackendBlock[]>();
    getDocument.mockImplementationOnce(() => late.promise);
    getDocument.mockImplementation((_ctx, doc) => Promise.resolve(blocks(doc)));
    const { result, rerender } = renderHook(({ i }) => useTextIndex(i), {
      initialProps: { i: input([row('old', 'x')], { old: 'ready' }) },
    });
    await settle();
    rerender({ i: input([row('new', 'y')], { new: 'ready' }) });
    await settle();
    late.resolve(blocks('old text'));
    await settle();
    expect([...result.current.texts.keys()]).toEqual(['new/y']);
  });

  it('stops reading once unmounted, as a workspace switch remounts it', async () => {
    const held: (() => void)[] = [];
    getDocument.mockImplementation(
      (_ctx, doc) =>
        new Promise((resolve) => held.push(() => resolve(blocks(doc)))),
    );
    const rows = ['a', 'b', 'c', 'd', 'e'].map((d) => row('f1', d));
    const { unmount } = renderHook(() =>
      useTextIndex(input(rows, { f1: 'ready' })),
    );
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(TEXT_INDEX_CONCURRENCY);
    unmount();
    held.forEach((done) => done());
    await settle(2_000);
    expect(getDocument).toHaveBeenCalledTimes(TEXT_INDEX_CONCURRENCY);
  });

  it('reads nothing again on a remount in the same session, only what changed', async () => {
    getDocument.mockImplementation((_ctx, doc) =>
      Promise.resolve(blocks(`v1 ${doc}`)),
    );
    const rows = [row('f1', 'a', false, 5), row('f1', 'b', false, 5)];
    const { unmount } = renderHook(() =>
      useTextIndex(input(rows, { f1: 'ready' })),
    );
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(2);
    unmount();

    // Switching workspace and back remounts the index.
    const view = renderHook(() =>
      useTextIndex(
        input([row('f1', 'a', false, 5), row('f1', 'b', false, 8)], {
          f1: 'ready',
        }),
      ),
    );
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(getDocument).toHaveBeenLastCalledWith('c-f1', 'b');
    expect(textOf(view.result, 'f1/a')).toBe('v1 a');
    expect(view.result.current).toMatchObject({ foldersDone: 1, pending: [] });
    view.unmount();

    // A new session (a new mero client) keeps nothing.
    mero = {};
    renderHook(() => useTextIndex(input(rows, { f1: 'ready' })));
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(5);
  });

  it('forgets a doc that left the list', async () => {
    getDocument.mockImplementation((_ctx, doc) => Promise.resolve(blocks(doc)));
    const both = [row('f1', 'a'), row('f1', 'b')];
    const { rerender, unmount } = renderHook(
      ({ rows }) => useTextIndex(input(rows, { f1: 'ready' })),
      { initialProps: { rows: both } },
    );
    await settle();
    rerender({ rows: [row('f1', 'a')] });
    await settle();
    unmount();

    renderHook(() => useTextIndex(input(both, { f1: 'ready' })));
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(getDocument).toHaveBeenLastCalledWith('c-f1', 'b');
  });

  it('asks an edited doc for its version, so the list catching up reads nothing more', async () => {
    getDocument.mockImplementation((_ctx, doc) =>
      Promise.resolve(blocks(`v1 ${doc}`)),
    );
    const { result, rerender } = renderHook(
      ({ rows }) => useTextIndex(input(rows, { f1: 'ready' })),
      { initialProps: { rows: [row('f1', 'a', false, 5)] } },
    );
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(1);

    getDoc.mockResolvedValue({ updated_at: 9 * 1_000_000 });
    getDocument.mockImplementation((_ctx, doc) =>
      Promise.resolve(blocks(`v2 ${doc}`)),
    );
    act(() => {
      subscribed!.handler({
        contextId: 'c-f1',
        type: 'StateMutation',
        data: { BlockChanged: { doc: 'a', block: 'b1' } },
      });
    });
    await settle(1_500);
    expect(getDoc).toHaveBeenCalledWith('c-f1', 'a');
    expect(getDocument).toHaveBeenCalledTimes(2);

    // The list refetch the same edit caused.
    rerender({ rows: [row('f1', 'a', false, 9)] });
    await settle();
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(textOf(result, 'f1/a')).toBe('v2 a');
  });
});
