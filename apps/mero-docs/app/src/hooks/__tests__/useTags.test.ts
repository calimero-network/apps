import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { TagNameTakenError, useTagsSource } from '../useTags';
import { row } from '@/lib/workspaceIndex/__tests__/row';
import type { IndexRow } from '@/lib/workspaceIndex/types';

const listTags = vi.fn();
const setTag = vi.fn();
const deleteTag = vi.fn();
const removeTag = vi.fn();
const notifyDocsRefetch = vi.fn();
const toastError = vi.hoisted(() => vi.fn());
let onRegistryEvent: (() => void) | null = null;
let watched: unknown = null;
type Client = {
  listTags: typeof listTags;
  setTag?: typeof setTag;
  deleteTag?: typeof deleteTag;
};
const ws = {
  registryClient: { listTags, setTag, deleteTag } as Client | null,
  registryContextId: 'reg-ctx',
};
const index = {
  rows: [] as IndexRow[],
  contextOf: (folderId: string) => `ctx-${folderId}`,
};

vi.mock('../useDriveWorkspace', () => ({ useDriveWorkspace: () => ws }));
vi.mock('../useDocs', () => ({
  notifyDocsRefetch: (id: string) => notifyDocsRefetch(id),
}));
let mero: object | null = {};
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ mero }),
}));
vi.mock('@/generated/docs/DocsClient', () => ({
  DocsClient: class {
    constructor(
      _mero: unknown,
      private contextId: string,
    ) {}
    removeTag(params: { id: string; tag: string }) {
      return removeTag(this.contextId, params);
    }
  },
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
vi.mock('../useContextEvents', () => ({
  useContextEvents: (ids: unknown, handler: () => void) => {
    watched = ids;
    onRegistryEvent = handler;
  },
}));

const tag = (key: string, name = key, deleted = false) => ({
  key,
  name,
  color: '#3b82f6',
  deleted,
});

beforeEach(() => {
  vi.clearAllMocks();
  listTags.mockReset();
  setTag.mockReset().mockResolvedValue(undefined);
  deleteTag.mockReset().mockResolvedValue(undefined);
  removeTag.mockReset().mockResolvedValue(undefined);
  ws.registryClient = { listTags, setTag, deleteTag };
  index.rows = [];
  mero = {};
  onRegistryEvent = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.useRealTimers());

describe('useTagsSource', () => {
  it('reads the workspace tags and indexes them by key', async () => {
    listTags.mockResolvedValue([tag('q3'), tag('old', 'Old', true)]);
    const { result } = renderHook(() => useTagsSource(index));
    await waitFor(() => expect(result.current.tags).toHaveLength(2));
    expect(result.current.byKey.get('old')?.deleted).toBe(true);
    expect(watched).toBe('reg-ctx');
  });

  it('re-reads when a registry change lands', async () => {
    listTags.mockResolvedValue([tag('q3')]);
    const { result } = renderHook(() => useTagsSource(index));
    await waitFor(() => expect(result.current.tags).toHaveLength(1));

    listTags.mockResolvedValue([tag('q3'), tag('design')]);
    await act(async () => onRegistryEvent?.());
    await waitFor(() => expect(result.current.byKey.has('design')).toBe(true));
  });

  it('keeps the last good tags through a failed re-read', async () => {
    listTags.mockResolvedValue([tag('q3')]);
    const { result } = renderHook(() => useTagsSource(index));
    await waitFor(() => expect(result.current.tags).toHaveLength(1));

    listTags.mockRejectedValue(new Error('node down'));
    await act(async () => onRegistryEvent?.());
    expect(result.current.tags).toHaveLength(1);
  });

  it('shows no tags from another workspace', async () => {
    listTags.mockResolvedValue([tag('q3')]);
    const { result, rerender } = renderHook(() => useTagsSource(index));
    await waitFor(() => expect(result.current.tags).toHaveLength(1));

    const other = vi.fn(() => new Promise(() => {}));
    ws.registryClient = { listTags: other };
    rerender();
    expect(result.current.tags).toEqual([]);
  });

  it('retries a failed first read a few times, so chips are named, then stops', async () => {
    vi.useFakeTimers();
    listTags
      .mockRejectedValueOnce(new Error('not synced'))
      .mockRejectedValueOnce(new Error('not synced'))
      .mockResolvedValue([tag('q3')]);
    const { result } = renderHook(() => useTagsSource(index));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(result.current.byKey.has('q3')).toBe(true);
    expect(listTags).toHaveBeenCalledTimes(3);

    listTags.mockReset().mockRejectedValue(new Error('down'));
    const other = { listTags };
    ws.registryClient = other;
    const view = renderHook(() => useTagsSource(index));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(listTags).toHaveBeenCalledTimes(3);
    expect(view.result.current.tags).toEqual([]);
  });
});

async function loaded(tags: ReturnType<typeof tag>[]) {
  listTags.mockResolvedValue(tags);
  const view = renderHook(() => useTagsSource(index));
  // An empty list looks read before the read lands, so wait for the read itself.
  await waitFor(() => expect(listTags).toHaveBeenCalled());
  await act(async () => {
    await listTags.mock.results[0].value;
  });
  expect(view.result.current.tags).toHaveLength(tags.length);
  listTags.mockReturnValue(new Promise(() => {})); // the re-read after a write stays out of the way
  return view;
}

describe('useTagsSource writes', () => {
  it('reuses a live tag with the same name instead of creating one', async () => {
    const { result } = await loaded([tag('launch', 'launch')]);
    let key = '';
    await act(async () => {
      key = await result.current.createTag('  Launch ', '#ef4444');
    });
    expect(key).toBe('launch');
    expect(setTag).not.toHaveBeenCalled();
  });

  it('creates a new tag under a fresh key, never a deleted one, and shows it at once', async () => {
    const { result } = await loaded([tag('launch', 'launch', true)]);
    let key = '';
    await act(async () => {
      key = await result.current.createTag('🚀  launch', '#ef4444');
    });
    expect(key).toBe('launch-2');
    expect(setTag).toHaveBeenCalledWith({
      key: 'launch-2',
      name: '🚀 launch',
      color: '#ef4444',
    });
    expect(result.current.byKey.get('launch-2')?.name).toBe('🚀 launch');
  });

  it('keys a name with no latin letters or digits randomly', async () => {
    const { result } = await loaded([]);
    let key = '';
    await act(async () => {
      key = await result.current.createTag('日本', '#3b82f6');
    });
    expect(key).toMatch(/^t-[a-z0-9]{6}$/);
    expect(setTag).toHaveBeenCalledWith({
      key,
      name: '日本',
      color: '#3b82f6',
    });
  });

  it('refuses an empty name without writing', async () => {
    const { result } = await loaded([]);
    await expect(result.current.createTag('   ', '#3b82f6')).rejects.toThrow();
    expect(setTag).not.toHaveBeenCalled();
  });

  it('refuses a rename to a name another live tag has', async () => {
    const { result } = await loaded([
      tag('q3', 'Q3'),
      tag('plan', 'Plan'),
      tag('old', 'Old', true),
    ]);
    await expect(
      result.current.renameTag('q3', ' plan '),
    ).rejects.toBeInstanceOf(TagNameTakenError);
    expect(setTag).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();

    await act(async () => result.current.renameTag('q3', 'old'));
    await act(async () => result.current.renameTag('q3', 'q3'));
    expect(setTag).toHaveBeenNthCalledWith(1, {
      key: 'q3',
      name: 'old',
      color: '#3b82f6',
    });
    expect(setTag).toHaveBeenNthCalledWith(2, {
      key: 'q3',
      name: 'q3',
      color: '#3b82f6',
    });
  });

  it('recolours a tag and keeps its name', async () => {
    const { result } = await loaded([tag('q3', 'Q3')]);
    await act(async () => result.current.recolorTag('q3', '#ef4444'));
    expect(setTag).toHaveBeenCalledWith({
      key: 'q3',
      name: 'Q3',
      color: '#ef4444',
    });
    expect(result.current.byKey.get('q3')?.color).toBe('#ef4444');
  });

  it('deletes a tag from the docs in folders you can edit, then marks it deleted', async () => {
    index.rows = [
      row({ folderId: 'f1', docId: 'a', tags: ['q3'] }),
      row({ folderId: 'f1', docId: 'b', tags: ['other'] }),
      row({ folderId: 'f2', docId: 'c', tags: ['q3'], archived: true }),
      row({ folderId: 'locked', docId: 'd', tags: ['q3'] }),
    ];
    const { result } = await loaded([tag('q3', 'Q3')]);
    const order: string[] = [];
    removeTag.mockImplementation(async (ctx: string) => void order.push(ctx));
    deleteTag.mockImplementation(async () => void order.push('delete'));
    await act(async () =>
      result.current.deleteTag('q3', new Set(['f1', 'f2'])),
    );
    expect(removeTag.mock.calls).toEqual([
      ['ctx-f1', { id: 'a', tag: 'q3' }],
      ['ctx-f2', { id: 'c', tag: 'q3' }],
    ]);
    expect(order[order.length - 1]).toBe('delete');
    expect(deleteTag).toHaveBeenCalledWith({ key: 'q3' });
    expect(notifyDocsRefetch).toHaveBeenCalledWith('ctx-f1');
    expect(result.current.byKey.get('q3')?.deleted).toBe(true);
  });

  it('still deletes the tag when a doc cannot be updated, since a deleted tag shows nowhere', async () => {
    index.rows = [row({ folderId: 'f1', docId: 'a', tags: ['q3'] })];
    const { result } = await loaded([tag('q3', 'Q3')]);
    removeTag.mockRejectedValue(new Error('boom'));
    await act(async () => result.current.deleteTag('q3', new Set(['f1'])));
    expect(deleteTag).toHaveBeenCalledWith({ key: 'q3' });
  });

  it('says a failed write plainly, never with the node text', async () => {
    const { result } = await loaded([tag('q3', 'Q3')]);
    setTag.mockRejectedValue(new Error('rpc: invalid tag key'));
    deleteTag.mockRejectedValue(new Error('rpc: storage'));
    await expect(result.current.recolorTag('q3', '#ef4444')).rejects.toThrow();
    await expect(result.current.deleteTag('q3', new Set())).rejects.toThrow();
    expect(toastError.mock.calls).toEqual([
      ["Couldn't save the tag. Try again."],
      ["Couldn't delete the tag. Try again."],
    ]);
    expect(result.current.byKey.get('q3')?.color).toBe('#3b82f6');
  });

  it('refuses every write until the first read lands, so no key or record is guessed', async () => {
    listTags.mockReturnValue(new Promise(() => {}));
    index.rows = [row({ folderId: 'f1', docId: 'a', tags: ['q3'] })];
    const { result } = renderHook(() => useTagsSource(index));
    await expect(
      result.current.createTag('launch', '#3b82f6'),
    ).rejects.toThrow();
    await expect(result.current.renameTag('q3', 'plan')).rejects.toThrow();
    await expect(result.current.recolorTag('q3', '#ef4444')).rejects.toThrow();
    await expect(
      result.current.deleteTag('q3', new Set(['f1'])),
    ).rejects.toThrow();
    expect(setTag).not.toHaveBeenCalled();
    expect(removeTag).not.toHaveBeenCalled();
    expect(deleteTag).not.toHaveBeenCalled();
    expect(toastError.mock.calls).toEqual([
      ["Couldn't save the tag. Try again."],
      ["Couldn't save the tag. Try again."],
      ["Couldn't save the tag. Try again."],
      ["Couldn't delete the tag. Try again."],
    ]);
  });

  it('refuses to rename or recolour a tag the latest read shows deleted', async () => {
    const { result } = await loaded([tag('old', 'Old', true)]);
    await expect(result.current.renameTag('old', 'New')).rejects.toThrow();
    await expect(result.current.recolorTag('old', '#ef4444')).rejects.toThrow();
    expect(setTag).not.toHaveBeenCalled();
    expect(toastError.mock.calls).toEqual([
      ['This tag has been deleted.'],
      ['This tag has been deleted.'],
    ]);
  });

  it('still deletes the tag with no node connection to untag docs through', async () => {
    mero = null;
    index.rows = [row({ folderId: 'f1', docId: 'a', tags: ['q3'] })];
    const { result } = await loaded([tag('q3', 'Q3')]);
    await act(async () => result.current.deleteTag('q3', new Set(['f1'])));
    expect(removeTag).not.toHaveBeenCalled();
    expect(deleteTag).toHaveBeenCalledWith({ key: 'q3' });
  });

  it('untags at most four docs at once', async () => {
    index.rows = Array.from({ length: 10 }, (_, i) =>
      row({ folderId: 'f1', docId: `d${i}`, tags: ['q3'] }),
    );
    const { result } = await loaded([tag('q3', 'Q3')]);
    let running = 0;
    let peak = 0;
    removeTag.mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
    });
    await act(async () => result.current.deleteTag('q3', new Set(['f1'])));
    expect(removeTag).toHaveBeenCalledTimes(10);
    expect(peak).toBe(4);
    expect(deleteTag).toHaveBeenCalledTimes(1);
  });
});
