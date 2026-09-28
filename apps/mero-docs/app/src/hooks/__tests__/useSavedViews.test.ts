import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSavedViewsSource } from '../useSavedViews';

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
  namespaceId: 'ws1',
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
    const { result } = renderHook(() => useSavedViewsSource());
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
    const { result } = renderHook(() => useSavedViewsSource());
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
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(result.current.views).toHaveLength(2));
    expect(result.current.views.map((v) => v.name)).toEqual(['apple', 'Zebra']);
  });

  it('re-reads shared views when a registry change lands', async () => {
    listViews.mockResolvedValue([dto('v1', 'One')]);
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(result.current.views).toHaveLength(1));

    listViews.mockResolvedValue([dto('v1', 'One'), dto('v2', 'Two')]);
    await act(async () => onRegistryEvent?.());
    await waitFor(() => expect(result.current.views).toHaveLength(2));
  });

  it('keeps the last good shared list through a failed re-read', async () => {
    listViews.mockResolvedValue([dto('v1', 'One')]);
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(result.current.views).toHaveLength(1));

    listViews.mockRejectedValue(new Error('node down'));
    await act(async () => onRegistryEvent?.());
    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        '[useSavedViews] read failed',
        expect.any(Error),
      ),
    );
    expect(result.current.views).toHaveLength(1);
  });

  it('saves a personal view to this device at once, with a fresh id', async () => {
    const { result } = renderHook(() => useSavedViewsSource());
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

  it("picks up another tab's personal views from the storage event", async () => {
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(listViews).toHaveBeenCalled());
    const value = JSON.stringify([{ id: 'p9', name: 'Other tab', query: 'tag=x' }]);
    localStorage.setItem('mero-drive:views:ws1', value);
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'mero-drive:views:ws1', newValue: value }),
      );
    });
    expect(result.current.views.map((v) => v.name)).toEqual(['Other tab']);
  });

  it("keeps another tab's personal view when renaming or removing one here", async () => {
    const { result } = renderHook(() => useSavedViewsSource());
    let saved!: Awaited<ReturnType<typeof result.current.save>>;
    await act(async () => {
      saved = await result.current.save('Mine', 'tag=x', 'me');
    });
    const other = { id: 'p9', name: 'Other tab', query: 'tag=y' };
    const stored = () =>
      JSON.parse(localStorage.getItem('mero-drive:views:ws1') ?? '[]');
    localStorage.setItem(
      'mero-drive:views:ws1',
      JSON.stringify([...stored(), other]),
    );

    await act(async () => result.current.rename(saved.id, 'Renamed'));
    expect(stored()).toEqual([
      { id: saved.id, name: 'Renamed', query: 'tag=x' },
      other,
    ]);

    await act(async () => result.current.remove(saved.id));
    expect(stored()).toEqual([other]);
    expect(result.current.views.map((v) => v.name)).toEqual(['Other tab']);
  });

  it('saves a shared view through the registry, then re-reads', async () => {
    const { result } = renderHook(() => useSavedViewsSource());
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
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(listViews).toHaveBeenCalled());
    await expect(
      result.current.save('Everyone view', 'tag=x', 'everyone'),
    ).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith("Couldn't save the view. Try again.");
    expect(result.current.views).toHaveLength(0);
  });

  it('says a shared save plainly while the registry is not ready', async () => {
    ws.registryClient = null;
    const { result } = renderHook(() => useSavedViewsSource());
    await expect(
      result.current.save('Everyone view', 'tag=x', 'everyone'),
    ).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith("Couldn't save the view. Try again.");
  });

  it('says a rename plainly when the view is gone', async () => {
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(listViews).toHaveBeenCalled());
    await expect(result.current.rename('missing', 'New')).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't rename the view. Try again.",
    );
  });

  it('says a shared delete plainly while the registry is not ready', async () => {
    ws.registryClient = null;
    const { result } = renderHook(() => useSavedViewsSource());
    await expect(result.current.remove('v1')).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't delete the view. Try again.",
    );
  });

  it('renames a personal view on this device', async () => {
    const { result } = renderHook(() => useSavedViewsSource());
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
    const { result } = renderHook(() => useSavedViewsSource());
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
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    await expect(result.current.rename('v1', 'New')).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't rename the view. Try again.",
    );
  });

  it('removes a personal view on this device', async () => {
    const { result } = renderHook(() => useSavedViewsSource());
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
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    listViews.mockResolvedValue([]);
    await act(async () => result.current.remove('v1'));
    expect(deleteView).toHaveBeenCalledWith({ id: 'v1' });
  });

  it('says a failed delete plainly', async () => {
    listViews.mockResolvedValue([dto('v1', 'Shared')]);
    deleteView.mockRejectedValue(new Error('rpc: down'));
    const { result } = renderHook(() => useSavedViewsSource());
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    await expect(result.current.remove('v1')).rejects.toThrow();
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't delete the view. Try again.",
    );
  });
});
