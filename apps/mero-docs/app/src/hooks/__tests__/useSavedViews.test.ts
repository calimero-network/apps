import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSavedViews } from '../useSavedViews';

const listViews = vi.fn();
const saveView = vi.fn();
const deleteView = vi.fn();
const toastError = vi.hoisted(() => vi.fn());
let onRegistryEvent: (() => void) | null = null;
let watched: unknown = null;
type Client = {
  listViews: typeof listViews;
  saveView?: typeof saveView;
  deleteView?: typeof deleteView;
};
const ws = {
  registryClient: { listViews, saveView, deleteView } as Client | null,
  registryContextId: 'reg-ctx',
};

vi.mock('../useDriveWorkspace', () => ({ useDriveWorkspace: () => ws }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
vi.mock('../useContextEvents', () => ({
  useContextEvents: (ids: unknown, handler: () => void) => {
    watched = ids;
    onRegistryEvent = handler;
  },
}));

const dto = (id: string, name: string, createdBy = 'alice') => ({
  id,
  name,
  query: 'tag=design',
  created_by: createdBy,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listViews.mockReset().mockResolvedValue([]);
  saveView.mockReset().mockResolvedValue(undefined);
  deleteView.mockReset().mockResolvedValue(undefined);
  ws.registryClient = { listViews, saveView, deleteView };
  onRegistryEvent = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useSavedViews', () => {
  it('reads shared views from the registry, watching the registry context', async () => {
    listViews.mockResolvedValue([dto('v1', 'Q3 launch')]);
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    expect(result.current.views[0]).toEqual({
      id: 'v1',
      name: 'Q3 launch',
      query: 'tag=design',
      scope: 'everyone',
      createdBy: 'alice',
    });
    expect(watched).toBe('reg-ctx');
  });

  it('reads personal views from this device only', async () => {
    localStorage.setItem(
      'mero-drive:views:ws1',
      JSON.stringify([{ id: 'p1', name: 'Mine', query: 'tag=x' }]),
    );
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    expect(result.current.views[0]).toEqual({
      id: 'p1',
      name: 'Mine',
      query: 'tag=x',
      scope: 'me',
    });
  });

  it('merges personal and shared views, sorted by name', async () => {
    localStorage.setItem(
      'mero-drive:views:ws1',
      JSON.stringify([{ id: 'p1', name: 'Zebra', query: 'tag=x' }]),
    );
    listViews.mockResolvedValue([dto('v1', 'apple')]);
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(2));
    expect(result.current.views.map((v) => v.name)).toEqual(['apple', 'Zebra']);
  });

  it('re-reads shared views when a registry change lands', async () => {
    listViews.mockResolvedValue([dto('v1', 'One')]);
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(1));

    listViews.mockResolvedValue([dto('v1', 'One'), dto('v2', 'Two')]);
    await act(async () => onRegistryEvent?.());
    await waitFor(() => expect(result.current.views).toHaveLength(2));
  });

  it('keeps the last good shared list through a failed re-read', async () => {
    listViews.mockResolvedValue([dto('v1', 'One')]);
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(1));

    listViews.mockRejectedValue(new Error('node down'));
    await act(async () => onRegistryEvent?.());
    expect(result.current.views).toHaveLength(1);
  });

  it('saves a personal view to this device at once, with a fresh id', async () => {
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(listViews).toHaveBeenCalled());
    let saved!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      saved = await result.current.save('Design week', 'tag=design', 'me');
    });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.scope).toBe('me');
    expect(result.current.views.map((v) => v.name)).toContain('Design week');
    expect(saveView).not.toHaveBeenCalled();
    const stored = JSON.parse(
      localStorage.getItem('mero-drive:views:ws1') ?? '[]',
    );
    expect(stored).toEqual([
      { id: saved.id, name: 'Design week', query: 'tag=design' },
    ]);
  });

  it('a personal save is seen at once by another instance for the same workspace', async () => {
    const { result: firstResult } = renderHook(() => useSavedViews('ws1'));
    const { result: secondResult } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(listViews).toHaveBeenCalled());
    await act(async () => {
      await firstResult.current.save('Mine', 'tag=x', 'me');
    });
    await waitFor(() =>
      expect(secondResult.current.views.map((v) => v.name)).toContain('Mine'),
    );
  });

  it('saves a shared view through the registry, then re-reads', async () => {
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(listViews).toHaveBeenCalled());
    listViews.mockResolvedValue([dto('new-id', 'Everyone view')]);
    let saved!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      saved = await result.current.save('Everyone view', 'tag=x', 'everyone');
    });
    expect(saveView).toHaveBeenCalledWith({
      id: saved.id,
      name: 'Everyone view',
      query: 'tag=x',
    });
    await waitFor(() =>
      expect(result.current.views.some((v) => v.scope === 'everyone')).toBe(
        true,
      ),
    );
  });

  it('says a failed shared save plainly and leaves nothing added', async () => {
    saveView.mockRejectedValue(new Error('rpc: down'));
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(listViews).toHaveBeenCalled());
    await expect(
      result.current.save('Everyone view', 'tag=x', 'everyone'),
    ).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith("Couldn't save the view. Try again.");
    expect(result.current.views).toHaveLength(0);
  });

  it('renames a personal view on this device', async () => {
    const { result } = renderHook(() => useSavedViews('ws1'));
    let saved!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      saved = await result.current.save('Old name', 'tag=x', 'me');
    });
    await act(async () => result.current.rename(saved.id, 'New name'));
    expect(result.current.views[0].name).toBe('New name');
    expect(saveView).not.toHaveBeenCalled();
  });

  it('renames a shared view by re-saving its id and query, keeping the name change', async () => {
    listViews.mockResolvedValue([dto('v1', 'Old')]);
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    await act(async () => result.current.rename('v1', 'New'));
    expect(saveView).toHaveBeenCalledWith({
      id: 'v1',
      name: 'New',
      query: 'tag=design',
    });
  });

  it('says a failed rename plainly', async () => {
    listViews.mockResolvedValue([dto('v1', 'Old')]);
    saveView.mockRejectedValue(new Error('rpc: down'));
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    await expect(result.current.rename('v1', 'New')).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't rename the view. Try again.",
    );
  });

  it('removes a personal view on this device', async () => {
    const { result } = renderHook(() => useSavedViews('ws1'));
    let saved!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      saved = await result.current.save('Mine', 'tag=x', 'me');
    });
    await act(async () => result.current.remove(saved.id));
    expect(result.current.views).toHaveLength(0);
    expect(deleteView).not.toHaveBeenCalled();
  });

  it('removes a shared view through the registry', async () => {
    listViews.mockResolvedValue([dto('v1', 'Shared')]);
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    listViews.mockResolvedValue([]);
    await act(async () => result.current.remove('v1'));
    expect(deleteView).toHaveBeenCalledWith({ id: 'v1' });
  });

  it('says a failed delete plainly', async () => {
    listViews.mockResolvedValue([dto('v1', 'Shared')]);
    deleteView.mockRejectedValue(new Error('rpc: down'));
    const { result } = renderHook(() => useSavedViews('ws1'));
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    await expect(result.current.remove('v1')).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't delete the view. Try again.",
    );
  });
});
