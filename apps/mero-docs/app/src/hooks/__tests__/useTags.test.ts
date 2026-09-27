import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTagsSource } from '../useTags';

const listTags = vi.fn();
let onRegistryEvent: (() => void) | null = null;
let watched: unknown = null;
const ws = {
  registryClient: { listTags } as { listTags: typeof listTags } | null,
  registryContextId: 'reg-ctx',
};

vi.mock('../useDriveWorkspace', () => ({ useDriveWorkspace: () => ws }));
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
  listTags.mockReset();
  ws.registryClient = { listTags };
  onRegistryEvent = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useTagsSource', () => {
  it('reads the workspace tags and indexes them by key', async () => {
    listTags.mockResolvedValue([tag('q3'), tag('old', 'Old', true)]);
    const { result } = renderHook(() => useTagsSource());
    await waitFor(() => expect(result.current.tags).toHaveLength(2));
    expect(result.current.byKey.get('old')?.deleted).toBe(true);
    expect(watched).toBe('reg-ctx');
  });

  it('re-reads when a registry change lands', async () => {
    listTags.mockResolvedValue([tag('q3')]);
    const { result } = renderHook(() => useTagsSource());
    await waitFor(() => expect(result.current.tags).toHaveLength(1));

    listTags.mockResolvedValue([tag('q3'), tag('design')]);
    await act(async () => onRegistryEvent?.());
    await waitFor(() => expect(result.current.byKey.has('design')).toBe(true));
  });

  it('keeps the last good tags through a failed re-read', async () => {
    listTags.mockResolvedValue([tag('q3')]);
    const { result } = renderHook(() => useTagsSource());
    await waitFor(() => expect(result.current.tags).toHaveLength(1));

    listTags.mockRejectedValue(new Error('node down'));
    await act(async () => onRegistryEvent?.());
    expect(result.current.tags).toHaveLength(1);
  });

  it('shows no tags from another workspace', async () => {
    listTags.mockResolvedValue([tag('q3')]);
    const { result, rerender } = renderHook(() => useTagsSource());
    await waitFor(() => expect(result.current.tags).toHaveLength(1));

    const other = vi.fn(() => new Promise(() => {}));
    ws.registryClient = { listTags: other };
    rerender();
    expect(result.current.tags).toEqual([]);
  });
});
